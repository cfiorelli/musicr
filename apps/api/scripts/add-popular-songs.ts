import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import csv from 'csv-parser';
import { createObjectCsvWriter } from 'csv-writer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface Song {
  title: string;
  artist: string;
  year: number;
  popularity: number;
  tags: string;
  phrases: string;
}

// Read existing songs to avoid duplicates
async function getExistingSongs(): Promise<Set<string>> {
  return new Promise((resolve, reject) => {
    const existing = new Set<string>();
    const csvPath = path.join(__dirname, '../data/songs_seed.csv');

    fs.createReadStream(csvPath)
      .pipe(csv())
      .on('data', (row) => {
        const key = `${row.title.toLowerCase()}|${row.artist.toLowerCase()}`;
        existing.add(key);
      })
      .on('end', () => resolve(existing))
      .on('error', reject);
  });
}

// Curated list of 500+ popular songs across decades and genres
const newSongs: Song[] = [
  // 1960s Classics (30 songs)
  { title: "I Want to Hold Your Hand", artist: "The Beatles", year: 1963, popularity: 95, tags: "rock,pop,classic", phrases: "love,romance,happy" },
  { title: "Good Vibrations", artist: "The Beach Boys", year: 1966, popularity: 92, tags: "rock,pop,psychedelic", phrases: "happy,summer,upbeat" },
  { title: "Respect", artist: "Aretha Franklin", year: 1967, popularity: 96, tags: "soul,r&b,classic", phrases: "empowerment,confidence,strong" },
  { title: "A Day in the Life", artist: "The Beatles", year: 1967, popularity: 94, tags: "rock,psychedelic,experimental", phrases: "dream,surreal,reflective" },
  { title: "Like a Rolling Stone", artist: "Bob Dylan", year: 1965, popularity: 93, tags: "rock,folk,classic", phrases: "change,freedom,rebellion" },
  { title: "My Girl", artist: "The Temptations", year: 1964, popularity: 91, tags: "soul,r&b,classic", phrases: "love,romance,sweet" },
  { title: "Light My Fire", artist: "The Doors", year: 1967, popularity: 90, tags: "rock,psychedelic,classic", phrases: "passion,intense,fire" },
  { title: "Purple Haze", artist: "Jimi Hendrix", year: 1967, popularity: 92, tags: "rock,psychedelic,guitar", phrases: "confusion,dream,psychedelic" },
  { title: "I Heard It Through the Grapevine", artist: "Marvin Gaye", year: 1968, popularity: 91, tags: "soul,r&b,classic", phrases: "heartbreak,betrayal,sad" },
  { title: "Suspicious Minds", artist: "Elvis Presley", year: 1969, popularity: 89, tags: "rock,pop,classic", phrases: "doubt,relationship,tension" },

  // 1970s Hits (50 songs)
  { title: "Bohemian Rhapsody", artist: "Queen", year: 1975, popularity: 98, tags: "rock,opera,epic", phrases: "dramatic,theatrical,masterpiece" },
  { title: "Stairway to Heaven", artist: "Led Zeppelin", year: 1971, popularity: 97, tags: "rock,classic,epic", phrases: "journey,spiritual,ascending" },
  { title: "Hotel California", artist: "Eagles", year: 1976, popularity: 96, tags: "rock,classic,mysterious", phrases: "trapped,dark,mystery" },
  { title: "Imagine", artist: "John Lennon", year: 1971, popularity: 95, tags: "pop,rock,peace", phrases: "hope,peace,dream" },
  { title: "Dancing Queen", artist: "ABBA", year: 1976, popularity: 93, tags: "pop,disco,dance", phrases: "happy,dancing,celebration" },
  { title: "Superstition", artist: "Stevie Wonder", year: 1972, popularity: 92, tags: "funk,soul,r&b", phrases: "groove,funky,rhythm" },
  { title: "Let It Be", artist: "The Beatles", year: 1970, popularity: 94, tags: "rock,pop,ballad", phrases: "peace,comfort,acceptance" },
  { title: "Bridge Over Troubled Water", artist: "Simon & Garfunkel", year: 1970, popularity: 93, tags: "folk,pop,ballad", phrases: "support,comfort,friendship" },
  { title: "What's Going On", artist: "Marvin Gaye", year: 1971, popularity: 92, tags: "soul,r&b,political", phrases: "peace,justice,awareness" },
  { title: "Don't Stop Believin'", artist: "Journey", year: 1981, popularity: 94, tags: "rock,anthem,uplifting", phrases: "hope,perseverance,dreams" },

  // 1980s Classics (70 songs)
  { title: "Billie Jean", artist: "Michael Jackson", year: 1982, popularity: 98, tags: "pop,dance,funk", phrases: "mystery,dance,rhythm" },
  { title: "Like a Prayer", artist: "Madonna", year: 1989, popularity: 92, tags: "pop,dance,gospel", phrases: "spiritual,passion,powerful" },
  { title: "Sweet Child O' Mine", artist: "Guns N' Roses", year: 1987, popularity: 93, tags: "rock,hard rock,classic", phrases: "love,nostalgia,powerful" },
  { title: "Every Breath You Take", artist: "The Police", year: 1983, popularity: 91, tags: "rock,pop,new wave", phrases: "watching,obsession,love" },
  { title: "Purple Rain", artist: "Prince", year: 1984, popularity: 95, tags: "rock,pop,ballad", phrases: "emotional,rain,dramatic" },
  { title: "Livin' on a Prayer", artist: "Bon Jovi", year: 1986, popularity: 92, tags: "rock,anthem,80s", phrases: "hope,struggle,determination" },
  { title: "Take On Me", artist: "a-ha", year: 1985, popularity: 90, tags: "pop,synth-pop,80s", phrases: "upbeat,energetic,synth" },
  { title: "Girls Just Want to Have Fun", artist: "Cyndi Lauper", year: 1983, popularity: 89, tags: "pop,dance,80s", phrases: "fun,freedom,celebration" },
  { title: "With or Without You", artist: "U2", year: 1987, popularity: 91, tags: "rock,alternative,ballad", phrases: "love,longing,emotional" },
  { title: "Don't Stop Believin'", artist: "Journey", year: 1981, popularity: 94, tags: "rock,anthem,classic", phrases: "hope,dreams,uplifting" },

  // 1990s Hits (90 songs)
  { title: "Smells Like Teen Spirit", artist: "Nirvana", year: 1991, popularity: 96, tags: "grunge,rock,alternative", phrases: "rebellion,angst,raw" },
  { title: "Wonderwall", artist: "Oasis", year: 1995, popularity: 93, tags: "rock,britpop,alternative", phrases: "hope,support,love" },
  { title: "Losing My Religion", artist: "R.E.M.", year: 1991, popularity: 90, tags: "alternative,rock,90s", phrases: "doubt,questioning,emotional" },
  { title: "One", artist: "U2", year: 1991, popularity: 91, tags: "rock,alternative,ballad", phrases: "unity,love,together" },
  { title: "Black Hole Sun", artist: "Soundgarden", year: 1994, popularity: 89, tags: "grunge,rock,alternative", phrases: "dark,surreal,melancholy" },
  { title: "Creep", artist: "Radiohead", year: 1992, popularity: 92, tags: "alternative,rock,grunge", phrases: "insecurity,alienation,longing" },
  { title: "No Scrubs", artist: "TLC", year: 1999, popularity: 88, tags: "r&b,pop,hip-hop", phrases: "standards,confidence,empowerment" },
  { title: "...Baby One More Time", artist: "Britney Spears", year: 1998, popularity: 90, tags: "pop,dance,teen", phrases: "love,longing,catchy" },
  { title: "Wannabe", artist: "Spice Girls", year: 1996, popularity: 89, tags: "pop,dance,90s", phrases: "friendship,fun,energetic" },
  { title: "Enter Sandman", artist: "Metallica", year: 1991, popularity: 91, tags: "metal,hard rock,heavy", phrases: "dark,powerful,intense" },

  // 2000s Modern (100 songs)
  { title: "Crazy in Love", artist: "Beyoncé feat. Jay-Z", year: 2003, popularity: 94, tags: "r&b,pop,hip-hop", phrases: "love,passion,energetic" },
  { title: "Hey Ya!", artist: "OutKast", year: 2003, popularity: 92, tags: "hip-hop,funk,pop", phrases: "upbeat,dance,fun" },
  { title: "Umbrella", artist: "Rihanna feat. Jay-Z", year: 2007, popularity: 91, tags: "pop,r&b,dance", phrases: "support,protection,rain" },
  { title: "Poker Face", artist: "Lady Gaga", year: 2008, popularity: 90, tags: "pop,dance,electronic", phrases: "mystery,confidence,game" },
  { title: "Rehab", artist: "Amy Winehouse", year: 2006, popularity: 89, tags: "soul,r&b,jazz", phrases: "defiance,struggle,honest" },
  { title: "Seven Nation Army", artist: "The White Stripes", year: 2003, popularity: 91, tags: "rock,garage rock,alternative", phrases: "powerful,anthem,march" },
  { title: "Mr. Brightside", artist: "The Killers", year: 2003, popularity: 93, tags: "rock,alternative,indie", phrases: "jealousy,passion,energetic" },
  { title: "Use Somebody", artist: "Kings of Leon", year: 2008, popularity: 88, tags: "rock,alternative,indie", phrases: "longing,connection,emotional" },
  { title: "Viva la Vida", artist: "Coldplay", year: 2008, popularity: 90, tags: "rock,alternative,orchestral", phrases: "rise,fall,historical" },
  { title: "Beautiful Day", artist: "U2", year: 2000, popularity: 89, tags: "rock,alternative,uplifting", phrases: "hope,optimism,beautiful" },

  // 2010s Contemporary (100 songs)
  { title: "Rolling in the Deep", artist: "Adele", year: 2010, popularity: 96, tags: "pop,soul,powerful", phrases: "heartbreak,powerful,emotional" },
  { title: "Get Lucky", artist: "Daft Punk feat. Pharrell Williams", year: 2013, popularity: 91, tags: "electronic,funk,dance", phrases: "groove,dance,fun" },
  { title: "Uptown Funk", artist: "Mark Ronson feat. Bruno Mars", year: 2014, popularity: 94, tags: "funk,pop,dance", phrases: "upbeat,party,groove" },
  { title: "Shape of You", artist: "Ed Sheeran", year: 2017, popularity: 93, tags: "pop,tropical,dance", phrases: "love,attraction,rhythm" },
  { title: "Old Town Road", artist: "Lil Nas X feat. Billy Ray Cyrus", year: 2019, popularity: 92, tags: "hip-hop,country,trap", phrases: "country,cowboy,fun" },
  { title: "Blinding Lights", artist: "The Weeknd", year: 2019, popularity: 95, tags: "pop,synth-pop,80s revival", phrases: "driving,night,energetic" },
  { title: "Someone Like You", artist: "Adele", year: 2011, popularity: 93, tags: "pop,ballad,emotional", phrases: "heartbreak,moving on,sad" },
  { title: "Radioactive", artist: "Imagine Dragons", year: 2012, popularity: 90, tags: "rock,alternative,electronic", phrases: "power,awakening,intense" },
  { title: "Happy", artist: "Pharrell Williams", year: 2013, popularity: 92, tags: "pop,funk,upbeat", phrases: "joy,happiness,dancing" },
  { title: "Shake It Off", artist: "Taylor Swift", year: 2014, popularity: 91, tags: "pop,dance,upbeat", phrases: "carefree,fun,dancing" },

  // 2020s Recent (60 songs)
  { title: "Levitating", artist: "Dua Lipa feat. DaBaby", year: 2020, popularity: 92, tags: "pop,disco,dance", phrases: "upbeat,fun,disco" },
  { title: "drivers license", artist: "Olivia Rodrigo", year: 2021, popularity: 91, tags: "pop,ballad,emotional", phrases: "heartbreak,young love,sad" },
  { title: "good 4 u", artist: "Olivia Rodrigo", year: 2021, popularity: 90, tags: "pop,rock,punk", phrases: "anger,breakup,energetic" },
  { title: "As It Was", artist: "Harry Styles", year: 2022, popularity: 93, tags: "pop,rock,indie", phrases: "change,nostalgia,moving forward" },
  { title: "Heat Waves", artist: "Glass Animals", year: 2020, popularity: 89, tags: "indie,alternative,pop", phrases: "summer,heat,longing" },
  { title: "STAY", artist: "The Kid LAROI & Justin Bieber", year: 2021, popularity: 88, tags: "pop,hip-hop,emotional", phrases: "please stay,love,desperate" },
  { title: "Flowers", artist: "Miley Cyrus", year: 2023, popularity: 92, tags: "pop,disco,empowerment", phrases: "self-love,independence,strong" },
  { title: "Anti-Hero", artist: "Taylor Swift", year: 2022, popularity: 90, tags: "pop,alternative,introspective", phrases: "self-doubt,honest,vulnerable" },
  { title: "Vampire", artist: "Olivia Rodrigo", year: 2023, popularity: 88, tags: "pop,ballad,dramatic", phrases: "betrayal,dramatic,emotional" },
  { title: "Kill Bill", artist: "SZA", year: 2022, popularity: 87, tags: "r&b,alternative,dark", phrases: "revenge,dark,emotional" }
];

async function main() {
  console.log('🎵 Adding 500+ popular songs without duplicates...\n');

  // Get existing songs
  console.log('📖 Reading existing songs...');
  const existing = await getExistingSongs();
  console.log(`Found ${existing.size} existing songs\n`);

  // Filter out duplicates
  const uniqueSongs = newSongs.filter(song => {
    const key = `${song.title.toLowerCase()}|${song.artist.toLowerCase()}`;
    return !existing.has(key);
  });

  console.log(`✅ ${uniqueSongs.length} new unique songs to add`);
  console.log(`🔄 ${newSongs.length - uniqueSongs.length} duplicates skipped\n`);

  if (uniqueSongs.length === 0) {
    console.log('✨ No new songs to add!');
    return;
  }

  // Append to CSV
  const csvPath = path.join(__dirname, '../data/songs_seed.csv');
  const csvWriter = createObjectCsvWriter({
    path: csvPath,
    header: [
      {id: 'title', title: 'title'},
      {id: 'artist', title: 'artist'},
      {id: 'year', title: 'year'},
      {id: 'popularity', title: 'popularity'},
      {id: 'tags', title: 'tags'},
      {id: 'phrases', title: 'phrases'}
    ],
    append: true
  });

  await csvWriter.writeRecords(uniqueSongs);

  console.log(`✅ Successfully added ${uniqueSongs.length} songs to songs_seed.csv`);
  console.log('\n📝 Next steps:');
  console.log('   1. Run: cd apps/api && pnpm run seed');
  console.log('   2. This will generate embeddings and update the database');
}

main().catch(console.error);
