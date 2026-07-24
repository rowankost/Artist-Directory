const express = require('express');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
app.use(express.json());
// Looks directly in the root directory for your index.html
app.use(express.static(__dirname)); 

// Connect to MongoDB
const MONGO_URI = process.env.MONGO_URI;
mongoose.connect(MONGO_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

const artistSchema = new mongoose.Schema({
  name: { type: String, unique: true, required: true },
  twitterHandle: String,
  genre: String,
  featuredTags: [String],
  tags: [String],
  samples: [String]
});

const Artist = mongoose.model('Artist', artistSchema);

// Seed default data if empty
async function seedDefault() {
  const count = await Artist.countDocuments();
  if (count === 0) {
    await Artist.create({
      name: "Brikot",
      twitterHandle: "brikot_art",
      genre: "normal",
      featuredTags: ["tits", "thighs", "creampie"],
      tags: ["tits", "thighs", "creampie", "sweat", "stockings", "female", "solo", "uncensored", "high_res", "smiling"],
      samples: []
    });
    console.log("Seeded default artist.");
  }
}
seedDefault();

// API Routes
app.get('/api/artists', async (req, res) => {
  try {
    const artists = await Artist.find();
    res.json(artists);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/artists', async (req, res) => {
  try {
    const { artistName, twitterHandle, manualFeaturedTags } = req.body;
    const cleanTag = artistName.toLowerCase().trim();

    let samples = [];
    let allTagsSet = new Set();
    let furryScore = 0;

    try {
      const danbooruUrl = `https://danbooru.donmai.us/posts.json?tags=${encodeURIComponent(cleanTag + ' order:score')}&limit=4`;
      const response = await fetch(danbooruUrl);
      if (response.ok) {
        const posts = await response.json();
        if (Array.isArray(posts) && posts.length > 0) {
          samples = posts.map(p => {
            let rawUrl = p.file_url || p.large_file_url || p.preview_file_url;
            if (!rawUrl) return null;
            if (rawUrl.includes('cdn.donmai.us')) {
              return rawUrl.replace(/\/180x180\/|\/sample\//g, '/');
            }
            return rawUrl;
          }).filter(Boolean);

          posts.forEach(p => {
            if (p.tag_string) {
              p.tag_string.split(' ').forEach(t => {
                allTagsSet.add(t);
                if (['furry', 'anthro', 'scalie', 'feral'].includes(t)) furryScore++;
              });
            }
          });
        }
      }
    } catch (e) {
      console.warn("Danbooru fetch warning:", e);
    }

    const allTagsArray = Array.from(allTagsSet);
    let featured = manualFeaturedTags
      ? manualFeaturedTags.split(",").map(t => t.trim().toLowerCase()).filter(Boolean)
      : allTagsArray.slice(0, 3);

    const artistData = {
      name: artistName,
      twitterHandle: (twitterHandle || '').replace('@', '').trim(),
      genre: furryScore >= 1 ? "furry" : "normal",
      featuredTags: featured,
      tags: allTagsArray.length > 0 ? allTagsArray : featured,
      samples: samples
    };

    const updated = await Artist.findOneAndUpdate(
      { name: { $regex: new RegExp(`^${artistName}$`, 'i') } },
      artistData,
      { upsert: true, new: true }
    );

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/artists/:name', async (req, res) => {
  try {
    await Artist.findOneAndDelete({ name: req.params.name });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Dedicated endpoint for Goon Corner ---
app.get('/api/goon-corner', async (req, res) => {
  try {
    const artists = await Artist.find({});

    const goonCornerImages = await Promise.all(
      artists.map(async (artist) => {
        const formattedTag = artist.name.toLowerCase().trim().replace(/\s+/g, '_');
        const danbooruUrl = `https://danbooru.donmai.us/posts.json?tags=${encodeURIComponent('artist:' + formattedTag + ' order:random')}&limit=1`;
        
        try {
          const response = await fetch(danbooruUrl, {
            headers: {
              'User-Agent': 'ArtistTrackerApp/1.0 (by shock on danbooru)'
            }
          });
          if (response.ok) {
            const posts = await response.json();
            if (Array.isArray(posts) && posts.length > 0) {
              let p = posts[0];
              let rawUrl = p.file_url || p.large_file_url || p.preview_file_url;
              if (rawUrl) {
                if (rawUrl.includes('cdn.donmai.us')) {
                  rawUrl = rawUrl.replace(/\/180x180\/|\/sample\//g, '/');
                }
                return {
                  artistName: artist.name,
                  imageUrl: rawUrl,
                  postId: p.id
                };
              }
            }
          }
        } catch (fetchErr) {
          console.error(`Failed to fetch random image for ${artist.name}:`, fetchErr);
        }
        return null;
      })
    );

    res.json(goonCornerImages.filter(item => item !== null));
  } catch (err) {
    console.error('Error fetching goon corner images:', err);
    res.status(500).json({ error: err.message });
  }
});

// Explicitly catch all homepage route visits and serve the HTML file
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
