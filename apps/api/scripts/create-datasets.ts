const fs = require('fs');
const path = require('path');

// Ensure data directory exists
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Billboard 2020s hits
const billboard2020s = [
  { title: "Blinding Lights", artist: "The Weeknd", year: 2020, genre: "Pop", popularity: 100 },
  { title: "Watermelon Sugar", artist: "Harry Styles", year: 2020, genre: "Pop Rock", popularity: 95 },
  { title: "drivers license", artist: "Olivia Rodrigo", year: 2021, genre: "Pop", popularity: 98 },
  { title: "Good 4 U", artist: "Olivia Rodrigo", year: 2021, genre: "Pop Punk", popularity: 95 },
  { title: "Stay", artist: "The Kid LAROI & Justin Bieber", year: 2021, genre: "Pop", popularity: 92 },
  { title: "Heat Waves", artist: "Glass Animals", year: 2021, genre: "Indie Pop", popularity: 90 },
  { title: "As It Was", artist: "Harry Styles", year: 2022, genre: "Pop Rock", popularity: 97 },
  { title: "About Damn Time", artist: "Lizzo", year: 2022, genre: "Pop", popularity: 88 },
  { title: "Anti-Hero", artist: "Taylor Swift", year: 2022, genre: "Pop", popularity: 96 },
  { title: "Unholy", artist: "Sam Smith ft. Kim Petras", year: 2022, genre: "Pop", popularity: 85 }
];

// Billboard 2010s hits  
const billboard2010s = [
  { title: "Uptown Funk", artist: "Mark Ronson ft. Bruno Mars", year: 2015, genre: "Funk Pop", popularity: 100 },
  { title: "Despacito", artist: "Luis Fonsi ft. Daddy Yankee", year: 2017, genre: "Reggaeton", popularity: 100 },
  { title: "Shape of You", artist: "Ed Sheeran", year: 2017, genre: "Pop", popularity: 98 },
  { title: "Someone Like You", artist: "Adele", year: 2011, genre: "Pop Ballad", popularity: 95 },
  { title: "Rolling in the Deep", artist: "Adele", year: 2011, genre: "Pop Soul", popularity: 95 },
  { title: "Party Rock Anthem", artist: "LMFAO", year: 2011, genre: "Electronic", popularity: 90 },
  { title: "Call Me Maybe", artist: "Carly Rae Jepsen", year: 2012, genre: "Pop", popularity: 88 },
  { title: "Gangnam Style", artist: "PSY", year: 2012, genre: "K-Pop", popularity: 92 },
  { title: "Happy", artist: "Pharrell Williams", year: 2014, genre: "Pop", popularity: 95 },
  { title: "All About That Bass", artist: "Meghan Trainor", year: 2014, genre: "Pop", popularity: 85 },
  { title: "Shake It Off", artist: "Taylor Swift", year: 2014, genre: "Pop", popularity: 92 },
  { title: "Thinking Out Loud", artist: "Ed Sheeran", year: 2014, genre: "Pop Ballad", popularity: 88 }
];

// Billboard 2000s hits
const billboard2000s = [
  { title: "Crazy in Love", artist: "Beyoncé ft. Jay-Z", year: 2003, genre: "R&B", popularity: 95 },
  { title: "Hey Ya!", artist: "OutKast", year: 2003, genre: "Hip Hop", popularity: 92 },
  { title: "Since U Been Gone", artist: "Kelly Clarkson", year: 2004, genre: "Pop Rock", popularity: 88 },
  { title: "Hips Don't Lie", artist: "Shakira ft. Wyclef Jean", year: 2006, genre: "Latin Pop", popularity: 90 },
  { title: "Umbrella", artist: "Rihanna ft. Jay-Z", year: 2007, genre: "Pop", popularity: 95 },
  { title: "I Kissed a Girl", artist: "Katy Perry", year: 2008, genre: "Pop", popularity: 85 },
  { title: "Single Ladies", artist: "Beyoncé", year: 2008, genre: "Pop", popularity: 98 },
  { title: "Poker Face", artist: "Lady Gaga", year: 2009, genre: "Dance Pop", popularity: 92 },
  { title: "Tik Tok", artist: "Kesha", year: 2009, genre: "Electropop", popularity: 88 },
  { title: "Bad Romance", artist: "Lady Gaga", year: 2009, genre: "Dance Pop", popularity: 90 }
];

// Billboard 90s hits
const billboard90s = [
  { title: "Smells Like Teen Spirit", artist: "Nirvana", year: 1991, genre: "Grunge", popularity: 95 },
  { title: "I Will Always Love You", artist: "Whitney Houston", year: 1992, genre: "Pop Ballad", popularity: 98 },
  { title: "Juicy", artist: "The Notorious B.I.G.", year: 1994, genre: "Hip Hop", popularity: 90 },
  { title: "California Love", artist: "2Pac ft. Dr. Dre", year: 1996, genre: "Hip Hop", popularity: 92 },
  { title: "I Want It That Way", artist: "Backstreet Boys", year: 1999, genre: "Pop", popularity: 88 },
  { title: "Creep", artist: "Radiohead", year: 1992, genre: "Alternative Rock", popularity: 87 },
  { title: "Losing My Religion", artist: "R.E.M.", year: 1991, genre: "Alternative Rock", popularity: 85 },
  { title: "Black", artist: "Pearl Jam", year: 1991, genre: "Grunge", popularity: 83 }
];

// Diverse genres and classics
const diverseGenres = [
  // Classic Rock
  { title: "Stairway to Heaven", artist: "Led Zeppelin", year: 1971, genre: "Hard Rock", popularity: 100 },
  { title: "Bohemian Rhapsody", artist: "Queen", year: 1975, genre: "Rock", popularity: 100 },
  { title: "Hotel California", artist: "Eagles", year: 1977, genre: "Rock", popularity: 98 },
  { title: "Sweet Child O' Mine", artist: "Guns N' Roses", year: 1988, genre: "Hard Rock", popularity: 95 },
  { title: "Don't Stop Believin'", artist: "Journey", year: 1981, genre: "Rock", popularity: 92 },
  
  // Pop Classics
  { title: "Billie Jean", artist: "Michael Jackson", year: 1983, genre: "Pop", popularity: 100 },
  { title: "Like a Prayer", artist: "Madonna", year: 1989, genre: "Pop", popularity: 90 },
  { title: "Purple Rain", artist: "Prince", year: 1984, genre: "Pop Rock", popularity: 95 },
  
  // Electronic/Dance
  { title: "One More Time", artist: "Daft Punk", year: 2000, genre: "House", popularity: 85 },
  { title: "Levels", artist: "Avicii", year: 2011, genre: "Progressive House", popularity: 88 },
  { title: "Titanium", artist: "David Guetta ft. Sia", year: 2011, genre: "EDM", popularity: 87 },
  
  // Alternative/Indie
  { title: "Mr. Brightside", artist: "The Killers", year: 2004, genre: "Alternative Rock", popularity: 90 },
  { title: "Somebody That I Used to Know", artist: "Gotye ft. Kimbra", year: 2011, genre: "Indie Pop", popularity: 92 },
  { title: "Radioactive", artist: "Imagine Dragons", year: 2012, genre: "Alternative Rock", popularity: 88 },
  { title: "Seven Nation Army", artist: "The White Stripes", year: 2003, genre: "Alternative Rock", popularity: 87 },
  
  // R&B/Soul
  { title: "Respect", artist: "Aretha Franklin", year: 1967, genre: "Soul", popularity: 100 },
  { title: "What's Going On", artist: "Marvin Gaye", year: 1971, genre: "Soul", popularity: 92 },
  { title: "Superstition", artist: "Stevie Wonder", year: 1972, genre: "Funk", popularity: 90 },
  
  // Country
  { title: "Friends in Low Places", artist: "Garth Brooks", year: 1990, genre: "Country", popularity: 85 },
  { title: "Before He Cheats", artist: "Carrie Underwood", year: 2006, genre: "Country Pop", popularity: 82 },
  { title: "Need You Now", artist: "Lady Antebellum", year: 2010, genre: "Country Pop", popularity: 80 },
  
  // Reggae
  { title: "No Woman No Cry", artist: "Bob Marley", year: 1975, genre: "Reggae", popularity: 88 },
  { title: "Three Little Birds", artist: "Bob Marley", year: 1977, genre: "Reggae", popularity: 85 },
  
  // Folk/Singer-Songwriter
  { title: "The Sound of Silence", artist: "Simon & Garfunkel", year: 1965, genre: "Folk Rock", popularity: 90 },
  { title: "Fire and Rain", artist: "James Taylor", year: 1970, genre: "Folk Rock", popularity: 82 },
  
  // Jazz/Blues
  { title: "Feeling Good", artist: "Nina Simone", year: 1965, genre: "Jazz", popularity: 85 },
  { title: "The Thrill Is Gone", artist: "B.B. King", year: 1970, genre: "Blues", popularity: 80 }
];

// Write datasets to files
fs.writeFileSync(path.join(dataDir, 'billboard-2020s.json'), JSON.stringify(billboard2020s, null, 2));
fs.writeFileSync(path.join(dataDir, 'billboard-2010s.json'), JSON.stringify(billboard2010s, null, 2));
fs.writeFileSync(path.join(dataDir, 'billboard-2000s.json'), JSON.stringify(billboard2000s, null, 2));
fs.writeFileSync(path.join(dataDir, 'billboard-90s.json'), JSON.stringify(billboard90s, null, 2));
fs.writeFileSync(path.join(dataDir, 'diverse-genres.json'), JSON.stringify(diverseGenres, null, 2));

const totalSongs = billboard2020s.length + billboard2010s.length + billboard2000s.length + billboard90s.length + diverseGenres.length;
console.log(`✅ Created song datasets with ${totalSongs} songs across multiple genres and decades!`);
console.log('📁 Datasets created:');
console.log(`   - billboard-2020s.json: ${billboard2020s.length} songs`);
console.log(`   - billboard-2010s.json: ${billboard2010s.length} songs`);  
console.log(`   - billboard-2000s.json: ${billboard2000s.length} songs`);
console.log(`   - billboard-90s.json: ${billboard90s.length} songs`);
console.log(`   - diverse-genres.json: ${diverseGenres.length} songs`);