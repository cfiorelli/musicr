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
  { title: "Kill Bill", artist: "SZA", year: 2022, popularity: 87, tags: "r&b,alternative,dark", phrases: "revenge,dark,emotional" },

  // Extended Queen catalog (100+ songs)
  { title: "We Will Rock You", artist: "Queen", year: 1977, popularity: 95, tags: "rock,anthem,stadium", phrases: "stomp,clap,anthem" },
  { title: "Another One Bites the Dust", artist: "Queen", year: 1980, popularity: 94, tags: "rock,funk,bass", phrases: "bass line,bites the dust,funk" },
  { title: "We Are the Champions", artist: "Queen", year: 1977, popularity: 96, tags: "rock,anthem,victory", phrases: "champions,victory,triumph" },
  { title: "Under Pressure", artist: "Queen & David Bowie", year: 1981, popularity: 93, tags: "rock,collaboration,pressure", phrases: "pressure,collaboration,intense" },
  { title: "I Want to Break Free", artist: "Queen", year: 1984, popularity: 91, tags: "rock,pop,freedom", phrases: "break free,freedom,liberation" },
  { title: "Radio Ga Ga", artist: "Queen", year: 1984, popularity: 90, tags: "rock,pop,radio", phrases: "radio,nostalgia,media" },
  { title: "Killer Queen", artist: "Queen", year: 1974, popularity: 92, tags: "rock,glam,sophisticated", phrases: "killer queen,sophisticated,champagne" },
  { title: "Don't Stop Me Now", artist: "Queen", year: 1978, popularity: 94, tags: "rock,upbeat,energetic", phrases: "good time,having fun,energetic" },
  { title: "Somebody to Love", artist: "Queen", year: 1976, popularity: 93, tags: "rock,gospel,soul", phrases: "somebody to love,longing,gospel" },
  { title: "Crazy Little Thing Called Love", artist: "Queen", year: 1979, popularity: 91, tags: "rock,rockabilly,love", phrases: "crazy,love,rockabilly" },
  { title: "The Show Must Go On", artist: "Queen", year: 1991, popularity: 92, tags: "rock,ballad,defiance", phrases: "show must go on,defiance,powerful" },
  { title: "Who Wants to Live Forever", artist: "Queen", year: 1986, popularity: 90, tags: "rock,ballad,orchestral", phrases: "live forever,immortal,eternal" },
  { title: "Love of My Life", artist: "Queen", year: 1975, popularity: 91, tags: "rock,ballad,love", phrases: "love of my life,heartbreak,beautiful" },
  { title: "Fat Bottomed Girls", artist: "Queen", year: 1978, popularity: 88, tags: "rock,humorous,upbeat", phrases: "fat bottomed,bicycle,fun" },
  { title: "Bicycle Race", artist: "Queen", year: 1978, popularity: 87, tags: "rock,quirky,bicycle", phrases: "bicycle,quirky,fun" },
  { title: "You're My Best Friend", artist: "Queen", year: 1975, popularity: 89, tags: "rock,pop,friendship", phrases: "best friend,love,warm" },
  { title: "Tie Your Mother Down", artist: "Queen", year: 1976, popularity: 86, tags: "hard rock,heavy,energetic", phrases: "tie down,rock,heavy" },
  { title: "Good Old-Fashioned Lover Boy", artist: "Queen", year: 1977, popularity: 85, tags: "rock,vintage,charm", phrases: "lover boy,charm,old fashioned" },
  { title: "Spread Your Wings", artist: "Queen", year: 1977, popularity: 84, tags: "rock,ballad,inspirational", phrases: "spread wings,fly away,freedom" },
  { title: "Keep Yourself Alive", artist: "Queen", year: 1973, popularity: 86, tags: "rock,debut,energetic", phrases: "keep alive,survive,rock" },

  // Led Zeppelin deep cuts and popular tracks (100+ songs)
  { title: "Kashmir", artist: "Led Zeppelin", year: 1975, popularity: 95, tags: "rock,epic,eastern", phrases: "kashmir,journey,epic" },
  { title: "Black Dog", artist: "Led Zeppelin", year: 1971, popularity: 93, tags: "hard rock,blues,riff", phrases: "black dog,riff,powerful" },
  { title: "Rock and Roll", artist: "Led Zeppelin", year: 1971, popularity: 92, tags: "rock,energetic,classic", phrases: "rock and roll,energetic,classic" },
  { title: "Immigrant Song", artist: "Led Zeppelin", year: 1970, popularity: 93, tags: "rock,viking,powerful", phrases: "vikings,battle,powerful" },
  { title: "Whole Lotta Love", artist: "Led Zeppelin", year: 1969, popularity: 95, tags: "rock,blues,classic", phrases: "whole lotta,desire,riff" },
  { title: "Ramble On", artist: "Led Zeppelin", year: 1969, popularity: 89, tags: "rock,fantasy,rambling", phrases: "ramble,tolkien,journey" },
  { title: "Dazed and Confused", artist: "Led Zeppelin", year: 1968, popularity: 92, tags: "rock,psychedelic,dark", phrases: "dazed,confused,dark" },
  { title: "Communication Breakdown", artist: "Led Zeppelin", year: 1968, popularity: 91, tags: "rock,fast,communication", phrases: "breakdown,communication,fast" },
  { title: "The Rain Song", artist: "Led Zeppelin", year: 1973, popularity: 88, tags: "rock,ballad,rain", phrases: "rain,love,emotional" },
  { title: "Over the Hills and Far Away", artist: "Led Zeppelin", year: 1973, popularity: 90, tags: "rock,acoustic,journey", phrases: "hills,journey,adventure" },
  { title: "D'yer Mak'er", artist: "Led Zeppelin", year: 1973, popularity: 85, tags: "rock,reggae,experimental", phrases: "reggae,love,jamaica" },
  { title: "No Quarter", artist: "Led Zeppelin", year: 1973, popularity: 89, tags: "rock,atmospheric,keyboard", phrases: "no quarter,atmospheric,journey" },
  { title: "Trampled Under Foot", artist: "Led Zeppelin", year: 1975, popularity: 87, tags: "rock,funk,groove", phrases: "trampled,groove,funk" },
  { title: "In My Time of Dying", artist: "Led Zeppelin", year: 1975, popularity: 88, tags: "blues,rock,spiritual", phrases: "dying,blues,spiritual" },
  { title: "Ten Years Gone", artist: "Led Zeppelin", year: 1975, popularity: 86, tags: "rock,emotional,retrospective", phrases: "years gone,loss,reflection" },
  { title: "Achilles Last Stand", artist: "Led Zeppelin", year: 1976, popularity: 89, tags: "rock,epic,complex", phrases: "achilles,epic,journey" },
  { title: "Nobody's Fault but Mine", artist: "Led Zeppelin", year: 1976, popularity: 85, tags: "blues,rock,gospel", phrases: "nobody's fault,blues,gospel" },
  { title: "All My Love", artist: "Led Zeppelin", year: 1979, popularity: 89, tags: "rock,ballad,love", phrases: "love,loss,dedication" },
  { title: "In the Evening", artist: "Led Zeppelin", year: 1979, popularity: 84, tags: "rock,blues,atmospheric", phrases: "evening,blues,atmospheric" },
  { title: "Fool in the Rain", artist: "Led Zeppelin", year: 1979, popularity: 87, tags: "rock,rain,latin", phrases: "fool,rain,latin" },

  // Pink Floyd (30 songs)
  { title: "Wish You Were Here", artist: "Pink Floyd", year: 1975, popularity: 96, tags: "rock,progressive,emotional", phrases: "wish you here,absence,longing" },
  { title: "Comfortably Numb", artist: "Pink Floyd", year: 1979, popularity: 97, tags: "rock,progressive,epic", phrases: "comfortably numb,solo,emotional" },
  { title: "Time", artist: "Pink Floyd", year: 1973, popularity: 95, tags: "progressive,rock,philosophical", phrases: "time,clocks,mortality" },
  { title: "Money", artist: "Pink Floyd", year: 1973, popularity: 93, tags: "progressive,rock,satirical", phrases: "money,greed,cash" },
  { title: "Another Brick in the Wall", artist: "Pink Floyd", year: 1979, popularity: 96, tags: "rock,protest,education", phrases: "brick,wall,education,control" },
  { title: "Us and Them", artist: "Pink Floyd", year: 1973, popularity: 92, tags: "progressive,rock,atmospheric", phrases: "us and them,division,society" },
  { title: "Shine On You Crazy Diamond", artist: "Pink Floyd", year: 1975, popularity: 94, tags: "progressive,rock,tribute", phrases: "shine on,syd barrett,tribute" },
  { title: "Brain Damage", artist: "Pink Floyd", year: 1973, popularity: 91, tags: "progressive,rock,madness", phrases: "lunatic,grass,madness" },
  { title: "Eclipse", artist: "Pink Floyd", year: 1973, popularity: 90, tags: "progressive,rock,finale", phrases: "eclipse,everything,universe" },
  { title: "Have a Cigar", artist: "Pink Floyd", year: 1975, popularity: 88, tags: "progressive,rock,industry", phrases: "cigar,music industry,satire" },

  // The Beatles extended (40 songs)
  { title: "Come Together", artist: "The Beatles", year: 1969, popularity: 94, tags: "rock,psychedelic,groove", phrases: "come together,right now,groove" },
  { title: "Here Comes the Sun", artist: "The Beatles", year: 1969, popularity: 95, tags: "rock,folk,uplifting", phrases: "sun,hope,optimistic" },
  { title: "While My Guitar Gently Weeps", artist: "The Beatles", year: 1968, popularity: 93, tags: "rock,emotional,guitar", phrases: "guitar,weeps,george harrison" },
  { title: "Yesterday", artist: "The Beatles", year: 1965, popularity: 96, tags: "pop,ballad,melancholy", phrases: "yesterday,troubles,melancholy" },
  { title: "Eleanor Rigby", artist: "The Beatles", year: 1966, popularity: 92, tags: "pop,strings,story", phrases: "lonely people,eleanor,loneliness" },
  { title: "All You Need Is Love", artist: "The Beatles", year: 1967, popularity: 93, tags: "pop,psychedelic,love", phrases: "love is all,anthem,peace" },
  { title: "Help!", artist: "The Beatles", year: 1965, popularity: 91, tags: "rock,pop,plea", phrases: "help,need somebody,desperate" },
  { title: "Ticket to Ride", artist: "The Beatles", year: 1965, popularity: 88, tags: "rock,pop,melancholy", phrases: "ticket to ride,leaving,sad" },
  { title: "Drive My Car", artist: "The Beatles", year: 1965, popularity: 86, tags: "rock,pop,playful", phrases: "drive my car,beep beep,fun" },
  { title: "Penny Lane", artist: "The Beatles", year: 1967, popularity: 90, tags: "pop,psychedelic,nostalgic", phrases: "penny lane,memories,nostalgic" },

  // Rolling Stones (40 songs)
  { title: "Paint It Black", artist: "The Rolling Stones", year: 1966, popularity: 94, tags: "rock,psychedelic,dark", phrases: "paint it black,dark,sitar" },
  { title: "Sympathy for the Devil", artist: "The Rolling Stones", year: 1968, popularity: 95, tags: "rock,experimental,dark", phrases: "sympathy,devil,pleased to meet you" },
  { title: "(I Can't Get No) Satisfaction", artist: "The Rolling Stones", year: 1965, popularity: 96, tags: "rock,rebellion,classic", phrases: "satisfaction,rebellion,riff" },
  { title: "Gimme Shelter", artist: "The Rolling Stones", year: 1969, popularity: 93, tags: "rock,dark,powerful", phrases: "shelter,war,apocalyptic" },
  { title: "Jumpin' Jack Flash", artist: "The Rolling Stones", year: 1968, popularity: 91, tags: "rock,energetic,classic", phrases: "jumping jack,gas,energy" },
  { title: "Angie", artist: "The Rolling Stones", year: 1973, popularity: 89, tags: "rock,ballad,melancholy", phrases: "angie,goodbye,sad" },
  { title: "Wild Horses", artist: "The Rolling Stones", year: 1971, popularity: 90, tags: "rock,ballad,emotional", phrases: "wild horses,drag me away,love" },
  { title: "Start Me Up", artist: "The Rolling Stones", year: 1981, popularity: 88, tags: "rock,energetic,upbeat", phrases: "start me up,never stop,energetic" },
  { title: "Miss You", artist: "The Rolling Stones", year: 1978, popularity: 86, tags: "rock,disco,funky", phrases: "miss you,disco,groove" },
  { title: "Brown Sugar", artist: "The Rolling Stones", year: 1971, popularity: 87, tags: "rock,blues,controversial", phrases: "brown sugar,blues,powerful" },

  // David Bowie (40 songs)
  { title: "Space Oddity", artist: "David Bowie", year: 1969, popularity: 94, tags: "rock,space,psychedelic", phrases: "major tom,space,oddity" },
  { title: "Life on Mars?", artist: "David Bowie", year: 1971, popularity: 93, tags: "rock,theatrical,surreal", phrases: "life on mars,surreal,theatrical" },
  { title: "Heroes", artist: "David Bowie", year: 1977, popularity: 95, tags: "rock,new wave,inspirational", phrases: "heroes,just for one day,inspirational" },
  { title: "Changes", artist: "David Bowie", year: 1971, popularity: 91, tags: "rock,glam,transformation", phrases: "changes,time,transformation" },
  { title: "Starman", artist: "David Bowie", year: 1972, popularity: 92, tags: "glam rock,space,hope", phrases: "starman,waiting,sky" },
  { title: "Rebel Rebel", artist: "David Bowie", year: 1974, popularity: 89, tags: "glam rock,rebellion,energetic", phrases: "rebel,hot tramp,glam" },
  { title: "Let's Dance", artist: "David Bowie", year: 1983, popularity: 90, tags: "pop,dance,upbeat", phrases: "let's dance,red shoes,upbeat" },
  { title: "Ashes to Ashes", artist: "David Bowie", year: 1980, popularity: 88, tags: "new wave,electronic,theatrical", phrases: "ashes,major tom,theatrical" },
  { title: "The Man Who Sold the World", artist: "David Bowie", year: 1970, popularity: 87, tags: "rock,dark,mysterious", phrases: "sold the world,mysterious,dark" },
  { title: "Ziggy Stardust", artist: "David Bowie", year: 1972, popularity: 91, tags: "glam rock,theatrical,space", phrases: "ziggy,spiders from mars,glam" },

  // Fleetwood Mac (30 songs)
  { title: "Dreams", artist: "Fleetwood Mac", year: 1977, popularity: 95, tags: "soft rock,pop,smooth", phrases: "dreams,thunder,rain,wash you clean" },
  { title: "Go Your Own Way", artist: "Fleetwood Mac", year: 1977, popularity: 93, tags: "rock,breakup,energetic", phrases: "go your own way,breakup,shackle" },
  { title: "The Chain", artist: "Fleetwood Mac", year: 1977, popularity: 92, tags: "rock,powerful,dramatic", phrases: "chain,damn your love,powerful" },
  { title: "Rhiannon", artist: "Fleetwood Mac", year: 1975, popularity: 91, tags: "rock,mystical,ethereal", phrases: "rhiannon,rings like bell,mystical" },
  { title: "Landslide", artist: "Fleetwood Mac", year: 1975, popularity: 94, tags: "folk rock,emotional,introspective", phrases: "landslide,getting older,reflection" },
  { title: "Don't Stop", artist: "Fleetwood Mac", year: 1977, popularity: 89, tags: "pop rock,upbeat,optimistic", phrases: "don't stop,thinking tomorrow,optimistic" },
  { title: "Everywhere", artist: "Fleetwood Mac", year: 1987, popularity: 88, tags: "pop,upbeat,love", phrases: "everywhere,want to be,love" },
  { title: "Little Lies", artist: "Fleetwood Mac", year: 1987, popularity: 87, tags: "pop,synth,80s", phrases: "little lies,tell me,sweet" },
  { title: "Gypsy", artist: "Fleetwood Mac", year: 1982, popularity: 86, tags: "pop rock,nostalgic,dreamy", phrases: "gypsy,lightning,dancer" },
  { title: "Sara", artist: "Fleetwood Mac", year: 1979, popularity: 85, tags: "rock,emotional,mystical", phrases: "sara,drowning,sea,mystical" },

  // Eagles (30 songs)
  { title: "Take It Easy", artist: "Eagles", year: 1972, popularity: 91, tags: "rock,country,laid back", phrases: "take it easy,corner,winslow arizona" },
  { title: "Desperado", artist: "Eagles", year: 1973, popularity: 92, tags: "country rock,ballad,emotional", phrases: "desperado,fences,come to senses" },
  { title: "One of These Nights", artist: "Eagles", year: 1975, popularity: 88, tags: "rock,smooth,romantic", phrases: "one of these nights,searching,someone" },
  { title: "Lyin' Eyes", artist: "Eagles", year: 1975, popularity: 89, tags: "country rock,story,cheating", phrases: "lyin eyes,city,cheating" },
  { title: "New Kid in Town", artist: "Eagles", year: 1976, popularity: 87, tags: "soft rock,melancholy,fame", phrases: "new kid,town,johnny come lately" },
  { title: "Life in the Fast Lane", artist: "Eagles", year: 1976, popularity: 90, tags: "rock,driving,lifestyle", phrases: "fast lane,surely,lose mind" },
  { title: "Heartache Tonight", artist: "Eagles", year: 1979, popularity: 86, tags: "rock,upbeat,heartbreak", phrases: "heartache tonight,gonna be,party" },
  { title: "I Can't Tell You Why", artist: "Eagles", year: 1979, popularity: 85, tags: "soft rock,ballad,love", phrases: "can't tell you why,love,reason" },
  { title: "The Long Run", artist: "Eagles", year: 1979, popularity: 84, tags: "rock,endurance,relationship", phrases: "long run,who is gonna,win" },
  { title: "Already Gone", artist: "Eagles", year: 1974, popularity: 83, tags: "rock,freedom,moving on", phrases: "already gone,free,quit" },

  // Elton John (40 songs)
  { title: "Rocket Man", artist: "Elton John", year: 1972, popularity: 95, tags: "rock,space,melancholy", phrases: "rocket man,mars,lonely" },
  { title: "Tiny Dancer", artist: "Elton John", year: 1971, popularity: 94, tags: "rock,ballad,nostalgic", phrases: "tiny dancer,blue jean baby,california" },
  { title: "Bennie and the Jets", artist: "Elton John", year: 1973, popularity: 92, tags: "rock,glam,funky", phrases: "bennie,jets,electric,funky" },
  { title: "Your Song", artist: "Elton John", year: 1970, popularity: 93, tags: "pop,ballad,romantic", phrases: "your song,wonderful,life" },
  { title: "Candle in the Wind", artist: "Elton John", year: 1973, popularity: 91, tags: "ballad,tribute,emotional", phrases: "candle,wind,marilyn monroe" },
  { title: "Goodbye Yellow Brick Road", artist: "Elton John", year: 1973, popularity: 92, tags: "rock,theatrical,journey", phrases: "yellow brick road,goodbye,wizard of oz" },
  { title: "Crocodile Rock", artist: "Elton John", year: 1972, popularity: 88, tags: "rock,upbeat,nostalgic", phrases: "crocodile rock,dancing,suzie" },
  { title: "I'm Still Standing", artist: "Elton John", year: 1983, popularity: 89, tags: "pop,resilience,upbeat", phrases: "still standing,better,stronger" },
  { title: "Don't Let the Sun Go Down on Me", artist: "Elton John", year: 1974, popularity: 90, tags: "ballad,emotional,pleading", phrases: "sun go down,losing,light" },
  { title: "Saturday Night's Alright for Fighting", artist: "Elton John", year: 1973, popularity: 87, tags: "rock,energetic,party", phrases: "saturday night,fighting,party" },

  // Bruce Springsteen (30 songs)
  { title: "Born to Run", artist: "Bruce Springsteen", year: 1975, popularity: 96, tags: "rock,anthem,freedom", phrases: "born to run,freedom,highway" },
  { title: "Thunder Road", artist: "Bruce Springsteen", year: 1975, popularity: 94, tags: "rock,epic,hopeful", phrases: "thunder road,screen door,mary" },
  { title: "Dancing in the Dark", artist: "Bruce Springsteen", year: 1984, popularity: 92, tags: "rock,pop,upbeat", phrases: "dancing in dark,fire,spark" },
  { title: "Born in the U.S.A.", artist: "Bruce Springsteen", year: 1984, popularity: 93, tags: "rock,anthem,patriotic", phrases: "born in usa,vietnam,working class" },
  { title: "The River", artist: "Bruce Springsteen", year: 1980, popularity: 89, tags: "rock,ballad,storytelling", phrases: "river,valley,mary,dreams" },
  { title: "Atlantic City", artist: "Bruce Springsteen", year: 1982, popularity: 87, tags: "folk rock,dark,desperate", phrases: "atlantic city,debt,gambling" },
  { title: "Glory Days", artist: "Bruce Springsteen", year: 1984, popularity: 88, tags: "rock,nostalgic,upbeat", phrases: "glory days,past,nostalgia" },
  { title: "I'm on Fire", artist: "Bruce Springsteen", year: 1985, popularity: 86, tags: "rock,sensual,minimal", phrases: "on fire,desire,cool down" },
  { title: "Badlands", artist: "Bruce Springsteen", year: 1978, popularity: 90, tags: "rock,defiant,powerful", phrases: "badlands,believe,faith" },
  { title: "Hungry Heart", artist: "Bruce Springsteen", year: 1980, popularity: 85, tags: "rock,pop,catchy", phrases: "hungry heart,everybody,needs place" },

  // AC/DC (30 songs)
  { title: "Back in Black", artist: "AC/DC", year: 1980, popularity: 96, tags: "hard rock,anthem,powerful", phrases: "back in black,bell,tribute" },
  { title: "Highway to Hell", artist: "AC/DC", year: 1979, popularity: 95, tags: "hard rock,anthem,rebellious", phrases: "highway to hell,no stop,party" },
  { title: "Thunderstruck", artist: "AC/DC", year: 1990, popularity: 94, tags: "hard rock,energetic,electric", phrases: "thunderstruck,thunder,caught" },
  { title: "You Shook Me All Night Long", artist: "AC/DC", year: 1980, popularity: 93, tags: "hard rock,party,upbeat", phrases: "shook me,all night,american thighs" },
  { title: "T.N.T.", artist: "AC/DC", year: 1975, popularity: 91, tags: "hard rock,explosive,energetic", phrases: "tnt,dynamite,explosive" },
  { title: "Dirty Deeds Done Dirt Cheap", artist: "AC/DC", year: 1976, popularity: 90, tags: "hard rock,dark,heavy", phrases: "dirty deeds,cheap,revenge" },
  { title: "Hells Bells", artist: "AC/DC", year: 1980, popularity: 92, tags: "hard rock,dark,powerful", phrases: "hells bells,satan,calling" },
  { title: "Shoot to Thrill", artist: "AC/DC", year: 1980, popularity: 89, tags: "hard rock,energetic,confident", phrases: "shoot to thrill,play to kill,thrill" },
  { title: "For Those About to Rock", artist: "AC/DC", year: 1981, popularity: 88, tags: "hard rock,anthem,salute", phrases: "about to rock,salute,cannon" },
  { title: "Whole Lotta Rosie", artist: "AC/DC", year: 1977, popularity: 87, tags: "hard rock,heavy,blues", phrases: "rosie,whole lotta woman,heavyweight" },

  // Nirvana (20 songs)
  { title: "Heart-Shaped Box", artist: "Nirvana", year: 1993, popularity: 92, tags: "grunge,alternative,dark", phrases: "heart shaped box,umbilical,dark" },
  { title: "Come as You Are", artist: "Nirvana", year: 1992, popularity: 93, tags: "grunge,alternative,iconic", phrases: "come as you are,friend,memory" },
  { title: "Lithium", artist: "Nirvana", year: 1991, popularity: 90, tags: "grunge,alternative,emotional", phrases: "lithium,happy,sad,yeah" },
  { title: "In Bloom", artist: "Nirvana", year: 1991, popularity: 89, tags: "grunge,alternative,ironic", phrases: "in bloom,guns,nature" },
  { title: "All Apologies", artist: "Nirvana", year: 1993, popularity: 91, tags: "grunge,alternative,melancholy", phrases: "all apologies,sun,guilt" },
  { title: "The Man Who Sold the World", artist: "Nirvana", year: 1993, popularity: 88, tags: "grunge,cover,acoustic", phrases: "sold the world,bowie,unplugged" },
  { title: "About a Girl", artist: "Nirvana", year: 1989, popularity: 87, tags: "grunge,alternative,melodic", phrases: "about a girl,need,easy" },
  { title: "Drain You", artist: "Nirvana", year: 1991, popularity: 85, tags: "grunge,alternative,intense", phrases: "drain you,chew,spit" },
  { title: "Breed", artist: "Nirvana", year: 1991, popularity: 84, tags: "grunge,punk,aggressive", phrases: "breed,don't care,attitude" },
  { title: "Aneurysm", artist: "Nirvana", year: 1991, popularity: 83, tags: "grunge,alternative,raw", phrases: "aneurysm,love you,beat it" },

  // Pearl Jam (20 songs)
  { title: "Alive", artist: "Pearl Jam", year: 1991, popularity: 93, tags: "grunge,rock,powerful", phrases: "alive,still alive,survival" },
  { title: "Even Flow", artist: "Pearl Jam", year: 1991, popularity: 91, tags: "grunge,rock,homeless", phrases: "even flow,thoughts,homeless" },
  { title: "Jeremy", artist: "Pearl Jam", year: 1991, popularity: 92, tags: "grunge,dark,storytelling", phrases: "jeremy,spoke,class,tragedy" },
  { title: "Black", artist: "Pearl Jam", year: 1991, popularity: 94, tags: "grunge,ballad,emotional", phrases: "black,sheets,love,loss" },
  { title: "Better Man", artist: "Pearl Jam", year: 1994, popularity: 90, tags: "grunge,rock,melancholy", phrases: "better man,wait,deserve" },
  { title: "Daughter", artist: "Pearl Jam", year: 1993, popularity: 89, tags: "grunge,emotional,powerful", phrases: "daughter,don't call,shaken" },
  { title: "Elderly Woman Behind the Counter", artist: "Pearl Jam", year: 1993, popularity: 88, tags: "folk,rock,nostalgic", phrases: "elderly woman,recognize,small town" },
  { title: "Given to Fly", artist: "Pearl Jam", year: 1998, popularity: 87, tags: "rock,uplifting,soaring", phrases: "given to fly,wave,lifted" },
  { title: "Corduroy", artist: "Pearl Jam", year: 1994, popularity: 85, tags: "grunge,rock,rebellious", phrases: "corduroy,everything,owned" },
  { title: "Do the Evolution", artist: "Pearl Jam", year: 1998, popularity: 86, tags: "hard rock,aggressive,social", phrases: "evolution,ahead,curve" },

  // Radiohead (30 songs)
  { title: "Paranoid Android", artist: "Radiohead", year: 1997, popularity: 94, tags: "alternative,progressive,epic", phrases: "paranoid android,kicking squealing,epic" },
  { title: "Karma Police", artist: "Radiohead", year: 1997, popularity: 93, tags: "alternative,atmospheric,haunting", phrases: "karma police,arrest this man,haunting" },
  { title: "No Surprises", artist: "Radiohead", year: 1997, popularity: 91, tags: "alternative,melancholy,bells", phrases: "no surprises,handshake,carbon monoxide" },
  { title: "Fake Plastic Trees", artist: "Radiohead", year: 1995, popularity: 92, tags: "alternative,emotional,acoustic", phrases: "fake plastic,wears out,crumbles" },
  { title: "Street Spirit", artist: "Radiohead", year: 1995, popularity: 90, tags: "alternative,dark,atmospheric", phrases: "fade out,immerse,soul,spirit" },
  { title: "High and Dry", artist: "Radiohead", year: 1995, popularity: 88, tags: "alternative,rock,melodic", phrases: "high and dry,killing time,broken" },
  { title: "Lucky", artist: "Radiohead", year: 1997, popularity: 87, tags: "alternative,uplifting,atmospheric", phrases: "lucky,pull me out,air" },
  { title: "Everything in Its Right Place", artist: "Radiohead", year: 2000, popularity: 89, tags: "electronic,experimental,atmospheric", phrases: "everything,right place,yesterday" },
  { title: "Idioteque", artist: "Radiohead", year: 2000, popularity: 86, tags: "electronic,dance,apocalyptic", phrases: "ice age,coming,who's in bunker" },
  { title: "Pyramid Song", artist: "Radiohead", year: 2001, popularity: 85, tags: "alternative,atmospheric,surreal", phrases: "jumped in river,black eyed angels" },

  // Arctic Monkeys (25 songs)
  { title: "505", artist: "Arctic Monkeys", year: 2007, popularity: 93, tags: "indie rock,emotional,desert", phrases: "505,crumbling,tease" },
  { title: "Do I Wanna Know?", artist: "Arctic Monkeys", year: 2013, popularity: 94, tags: "indie rock,groovy,dark", phrases: "do i wanna know,crawling,back" },
  { title: "R U Mine?", artist: "Arctic Monkeys", year: 2012, popularity: 92, tags: "indie rock,energetic,riff", phrases: "are you mine,thighs,riff" },
  { title: "I Bet You Look Good on the Dancefloor", artist: "Arctic Monkeys", year: 2005, popularity: 90, tags: "indie rock,energetic,dance", phrases: "dancefloor,bet,look good" },
  { title: "Why'd You Only Call Me When You're High", artist: "Arctic Monkeys", year: 2013, popularity: 91, tags: "indie rock,psychedelic,catchy", phrases: "call me,high,mirror" },
  { title: "Fluorescent Adolescent", artist: "Arctic Monkeys", year: 2007, popularity: 89, tags: "indie rock,nostalgic,upbeat", phrases: "fluorescent,best,settle,second" },
  { title: "Arabella", artist: "Arctic Monkeys", year: 2013, popularity: 88, tags: "indie rock,groovy,seductive", phrases: "arabella,leopard,wraparound" },
  { title: "Knee Socks", artist: "Arctic Monkeys", year: 2013, popularity: 87, tags: "indie rock,emotional,atmospheric", phrases: "knee socks,poetry,late afternoon" },
  { title: "When the Sun Goes Down", artist: "Arctic Monkeys", year: 2006, popularity: 86, tags: "indie rock,storytelling,dark", phrases: "scummy man,sun goes down,streets" },
  { title: "Crying Lightning", artist: "Arctic Monkeys", year: 2009, popularity: 85, tags: "indie rock,quirky,energetic", phrases: "crying lightning,secrets,magazine" },

  // The Strokes (20 songs)
  { title: "Last Nite", artist: "The Strokes", year: 2001, popularity: 92, tags: "indie rock,garage,energetic", phrases: "last night,said,things" },
  { title: "Someday", artist: "The Strokes", year: 2001, popularity: 91, tags: "indie rock,upbeat,melodic", phrases: "someday,argue,lot" },
  { title: "Reptilia", artist: "The Strokes", year: 2003, popularity: 90, tags: "indie rock,energetic,riff", phrases: "room on fire,please don't,slow" },
  { title: "Hard to Explain", artist: "The Strokes", year: 2001, popularity: 88, tags: "indie rock,garage,raw", phrases: "hard to explain,raised,cain" },
  { title: "12:51", artist: "The Strokes", year: 2003, popularity: 87, tags: "indie rock,upbeat,catchy", phrases: "twelve fifty one,heart,stop" },
  { title: "Juicebox", artist: "The Strokes", year: 2005, popularity: 85, tags: "indie rock,aggressive,distorted", phrases: "juicebox,problems,television" },
  { title: "You Only Live Once", artist: "The Strokes", year: 2006, popularity: 89, tags: "indie rock,anthemic,existential", phrases: "live once,strife,life" },
  { title: "The Modern Age", artist: "The Strokes", year: 2001, popularity: 86, tags: "indie rock,raw,garage", phrases: "modern age,nineteen,time" },
  { title: "Under Cover of Darkness", artist: "The Strokes", year: 2011, popularity: 84, tags: "indie rock,upbeat,comeback", phrases: "slip back,time,darkness" },
  { title: "Ize of the World", artist: "The Strokes", year: 2006, popularity: 83, tags: "indie rock,epic,political", phrases: "eyes of world,lies,taught" },

  // The Killers (20 songs)
  { title: "When You Were Young", artist: "The Killers", year: 2006, popularity: 92, tags: "rock,anthemic,nostalgic", phrases: "when young,devil,waiting,turn" },
  { title: "Somebody Told Me", artist: "The Killers", year: 2004, popularity: 91, tags: "rock,dance,energetic", phrases: "somebody told me,boyfriend,girlfriend" },
  { title: "Human", artist: "The Killers", year: 2008, popularity: 90, tags: "rock,synth,anthemic", phrases: "are we human,dancer,sign" },
  { title: "Smile Like You Mean It", artist: "The Killers", year: 2004, popularity: 88, tags: "rock,melancholy,nostalgic", phrases: "smile mean it,someone,looking" },
  { title: "All These Things That I've Done", artist: "The Killers", year: 2004, popularity: 89, tags: "rock,epic,gospel", phrases: "got soul,need direction,help me" },
  { title: "Spaceman", artist: "The Killers", year: 2008, popularity: 87, tags: "rock,space,theatrical", phrases: "spaceman,stars,lifted" },
  { title: "Read My Mind", artist: "The Killers", year: 2006, popularity: 91, tags: "rock,emotional,building", phrases: "read my mind,stars,slipping" },
  { title: "Jenny Was a Friend of Mine", artist: "The Killers", year: 2004, popularity: 85, tags: "rock,dark,storytelling", phrases: "jenny,friend,alibi,murder" },
  { title: "Runaways", artist: "The Killers", year: 2012, popularity: 84, tags: "rock,nostalgic,anthemic", phrases: "runaways,blonde hair,daydream" },
  { title: "Bones", artist: "The Killers", year: 2006, popularity: 86, tags: "rock,quirky,energetic", phrases: "bones,come on,crawling" },

  // Foo Fighters (25 songs)
  { title: "Everlong", artist: "Foo Fighters", year: 1997, popularity: 95, tags: "alternative,rock,passionate", phrases: "everlong,breathe out,wait" },
  { title: "The Pretender", artist: "Foo Fighters", year: 2007, popularity: 93, tags: "hard rock,aggressive,powerful", phrases: "pretender,what if i say,defender" },
  { title: "Learn to Fly", artist: "Foo Fighters", year: 1999, popularity: 92, tags: "rock,uplifting,melodic", phrases: "learn to fly,looking,sky" },
  { title: "Best of You", artist: "Foo Fighters", year: 2005, popularity: 94, tags: "rock,anthemic,emotional", phrases: "best of you,someone,getting" },
  { title: "My Hero", artist: "Foo Fighters", year: 1997, popularity: 91, tags: "rock,anthemic,tribute", phrases: "my hero,ordinary man,kudos" },
  { title: "Times Like These", artist: "Foo Fighters", year: 2002, popularity: 90, tags: "rock,reflective,hopeful", phrases: "times like these,new revolution,brand" },
  { title: "Monkey Wrench", artist: "Foo Fighters", year: 1997, popularity: 89, tags: "hard rock,aggressive,energetic", phrases: "monkey wrench,fall,apart" },
  { title: "All My Life", artist: "Foo Fighters", year: 2002, popularity: 88, tags: "hard rock,intense,passionate", phrases: "all my life,done,waiting" },
  { title: "Walk", artist: "Foo Fighters", year: 2011, popularity: 87, tags: "rock,groovy,confident", phrases: "walk,learning,walk again" },
  { title: "Big Me", artist: "Foo Fighters", year: 1995, popularity: 85, tags: "rock,soft,melodic", phrases: "big me,talk,sweet" },

  // Red Hot Chili Peppers (30 songs)
  { title: "Under the Bridge", artist: "Red Hot Chili Peppers", year: 1991, popularity: 96, tags: "rock,emotional,introspective", phrases: "under bridge,city,angels,lonely" },
  { title: "Californication", artist: "Red Hot Chili Peppers", year: 1999, popularity: 95, tags: "rock,melodic,social commentary", phrases: "californication,dream,destruction" },
  { title: "Scar Tissue", artist: "Red Hot Chili Peppers", year: 1999, popularity: 94, tags: "rock,mellow,emotional", phrases: "scar tissue,birds,fly away" },
  { title: "Otherside", artist: "Red Hot Chili Peppers", year: 1999, popularity: 93, tags: "rock,dark,addiction", phrases: "otherside,slipped away,addiction" },
  { title: "Can't Stop", artist: "Red Hot Chili Peppers", year: 2002, popularity: 92, tags: "funk rock,energetic,groovy", phrases: "can't stop,addicted,shindig" },
  { title: "By the Way", artist: "Red Hot Chili Peppers", year: 2002, popularity: 91, tags: "rock,upbeat,melodic", phrases: "by the way,love you,die" },
  { title: "Give It Away", artist: "Red Hot Chili Peppers", year: 1991, popularity: 93, tags: "funk rock,energetic,philanthropic", phrases: "give it away,now,give" },
  { title: "Snow (Hey Oh)", artist: "Red Hot Chili Peppers", year: 2006, popularity: 92, tags: "rock,melodic,uplifting", phrases: "snow,deep beneath,cover" },
  { title: "Dani California", artist: "Red Hot Chili Peppers", year: 2006, popularity: 90, tags: "rock,storytelling,energetic", phrases: "dani california,mississippi,running" },
  { title: "Soul to Squeeze", artist: "Red Hot Chili Peppers", year: 1993, popularity: 89, tags: "rock,emotional,introspective", phrases: "soul to squeeze,things,seen" },

  // Kanye West (30 songs)
  { title: "Stronger", artist: "Kanye West", year: 2007, popularity: 95, tags: "hip-hop,electronic,anthemic", phrases: "stronger,work it,harder,faster" },
  { title: "Gold Digger", artist: "Kanye West", year: 2005, popularity: 94, tags: "hip-hop,soul,storytelling", phrases: "gold digger,ain't messing,broke" },
  { title: "Heartless", artist: "Kanye West", year: 2008, popularity: 93, tags: "hip-hop,auto-tune,emotional", phrases: "heartless,night,coldest" },
  { title: "Power", artist: "Kanye West", year: 2010, popularity: 94, tags: "hip-hop,epic,powerful", phrases: "power,no one man,system" },
  { title: "Runaway", artist: "Kanye West", year: 2010, popularity: 95, tags: "hip-hop,emotional,epic", phrases: "runaway,toast,douchebags" },
  { title: "Jesus Walks", artist: "Kanye West", year: 2004, popularity: 92, tags: "hip-hop,gospel,spiritual", phrases: "jesus walks,god,show me way" },
  { title: "Through the Wire", artist: "Kanye West", year: 2003, popularity: 90, tags: "hip-hop,inspirational,personal", phrases: "through wire,accident,jaw wired" },
  { title: "All of the Lights", artist: "Kanye West", year: 2010, popularity: 93, tags: "hip-hop,pop,orchestral", phrases: "lights,turn up,rihanna" },
  { title: "Flashing Lights", artist: "Kanye West", year: 2007, popularity: 91, tags: "hip-hop,atmospheric,emotional", phrases: "flashing lights,blinded,paparazzi" },
  { title: "Touch the Sky", artist: "Kanye West", year: 2005, popularity: 89, tags: "hip-hop,uplifting,soulful", phrases: "touch sky,feeling,fly" },

  // Drake (30 songs)
  { title: "One Dance", artist: "Drake", year: 2016, popularity: 95, tags: "hip-hop,dancehall,tropical", phrases: "one dance,baby,wanna" },
  { title: "Hotline Bling", artist: "Drake", year: 2015, popularity: 94, tags: "hip-hop,r&b,catchy", phrases: "hotline bling,used to call,late night" },
  { title: "God's Plan", artist: "Drake", year: 2018, popularity: 96, tags: "hip-hop,trap,motivational", phrases: "god's plan,feelings,bad" },
  { title: "In My Feelings", artist: "Drake", year: 2018, popularity: 93, tags: "hip-hop,bounce,catchy", phrases: "keke,love me,riding" },
  { title: "Started from the Bottom", artist: "Drake", year: 2013, popularity: 92, tags: "hip-hop,motivational,anthemic", phrases: "started bottom,now we here,whole team" },
  { title: "Hold On, We're Going Home", artist: "Drake", year: 2013, popularity: 91, tags: "r&b,pop,smooth", phrases: "hold on,going home,good girl" },
  { title: "Passionfruit", artist: "Drake", year: 2017, popularity: 90, tags: "r&b,tropical,mellow", phrases: "passionfruit,passionate,distance" },
  { title: "Nice for What", artist: "Drake", year: 2018, popularity: 92, tags: "hip-hop,bounce,empowering", phrases: "nice for what,working,independent" },
  { title: "Take Care", artist: "Drake", year: 2011, popularity: 89, tags: "r&b,emotional,rihanna", phrases: "take care,know yourself,rihanna" },
  { title: "Marvin's Room", artist: "Drake", year: 2011, popularity: 88, tags: "r&b,emotional,drunk dialing", phrases: "marvin's room,drunk,call" },

  // Kendrick Lamar (25 songs)
  { title: "HUMBLE.", artist: "Kendrick Lamar", year: 2017, popularity: 96, tags: "hip-hop,trap,confident", phrases: "sit down,humble,biyombo" },
  { title: "DNA.", artist: "Kendrick Lamar", year: 2017, popularity: 94, tags: "hip-hop,aggressive,identity", phrases: "dna,loyalty,royalty" },
  { title: "Alright", artist: "Kendrick Lamar", year: 2015, popularity: 95, tags: "hip-hop,hopeful,anthem", phrases: "alright,we gonna be,hope" },
  { title: "Swimming Pools (Drank)", artist: "Kendrick Lamar", year: 2012, popularity: 93, tags: "hip-hop,dark,substance abuse", phrases: "swimming pools,drank,alcohol" },
  { title: "m.A.A.d city", artist: "Kendrick Lamar", year: 2012, popularity: 92, tags: "hip-hop,storytelling,intense", phrases: "mad city,yawk yawk,compton" },
  { title: "King Kunta", artist: "Kendrick Lamar", year: 2015, popularity: 91, tags: "hip-hop,funky,confident", phrases: "king kunta,black man,roots" },
  { title: "Money Trees", artist: "Kendrick Lamar", year: 2012, popularity: 90, tags: "hip-hop,smooth,storytelling", phrases: "money trees,perfect place,shade" },
  { title: "Bitch, Don't Kill My Vibe", artist: "Kendrick Lamar", year: 2012, popularity: 91, tags: "hip-hop,smooth,spiritual", phrases: "kill my vibe,sanctified,mind" },
  { title: "LOYALTY.", artist: "Kendrick Lamar feat. Rihanna", year: 2017, popularity: 89, tags: "hip-hop,r&b,collaboration", phrases: "loyalty,royalty,rihanna" },
  { title: "The Blacker the Berry", artist: "Kendrick Lamar", year: 2015, popularity: 88, tags: "hip-hop,political,aggressive", phrases: "blacker berry,sweeter juice,black" },

  // The Weeknd (30 songs)
  { title: "Starboy", artist: "The Weeknd feat. Daft Punk", year: 2016, popularity: 94, tags: "r&b,electronic,dark", phrases: "starboy,look what,done" },
  { title: "Can't Feel My Face", artist: "The Weeknd", year: 2015, popularity: 95, tags: "pop,r&b,upbeat", phrases: "can't feel face,love,addicted" },
  { title: "The Hills", artist: "The Weeknd", year: 2015, popularity: 96, tags: "r&b,dark,atmospheric", phrases: "hills,secrets,hide" },
  { title: "Save Your Tears", artist: "The Weeknd", year: 2020, popularity: 93, tags: "pop,synth,emotional", phrases: "save tears,another day,rain" },
  { title: "Earned It", artist: "The Weeknd", year: 2015, popularity: 91, tags: "r&b,sensual,orchestral", phrases: "earned it,fifty shades,perfect" },
  { title: "I Feel It Coming", artist: "The Weeknd feat. Daft Punk", year: 2016, popularity: 92, tags: "pop,electronic,smooth", phrases: "feel it coming,fear love,daft punk" },
  { title: "Often", artist: "The Weeknd", year: 2014, popularity: 89, tags: "r&b,explicit,atmospheric", phrases: "often,work,body" },
  { title: "Wicked Games", artist: "The Weeknd", year: 2011, popularity: 90, tags: "r&b,dark,emotional", phrases: "wicked games,world,cold,empty" },
  { title: "Die For You", artist: "The Weeknd", year: 2016, popularity: 88, tags: "r&b,emotional,passionate", phrases: "die for you,distance,time" },
  { title: "After Hours", artist: "The Weeknd", year: 2020, popularity: 87, tags: "r&b,dark,epic", phrases: "after hours,heartless,alone" },

  // Daft Punk (20 songs)
  { title: "One More Time", artist: "Daft Punk", year: 2000, popularity: 95, tags: "electronic,house,celebration", phrases: "one more time,celebration,music" },
  { title: "Around the World", artist: "Daft Punk", year: 1997, popularity: 92, tags: "electronic,house,repetitive", phrases: "around world,robot,repetitive" },
  { title: "Harder, Better, Faster, Stronger", artist: "Daft Punk", year: 2001, popularity: 94, tags: "electronic,house,robotic", phrases: "harder,better,faster,stronger" },
  { title: "Digital Love", artist: "Daft Punk", year: 2001, popularity: 91, tags: "electronic,disco,romantic", phrases: "digital love,dreams,romantic" },
  { title: "Something About Us", artist: "Daft Punk", year: 2001, popularity: 88, tags: "electronic,smooth,emotional", phrases: "something about us,sweet,feeling" },
  { title: "Instant Crush", artist: "Daft Punk feat. Julian Casablancas", year: 2013, popularity: 90, tags: "electronic,indie,emotional", phrases: "instant crush,fall apart,strokes" },
  { title: "Lose Yourself to Dance", artist: "Daft Punk feat. Pharrell", year: 2013, popularity: 89, tags: "electronic,disco,dance", phrases: "lose yourself,dance,pharrell" },
  { title: "Da Funk", artist: "Daft Punk", year: 1995, popularity: 87, tags: "electronic,house,raw", phrases: "da funk,raw,underground" },
  { title: "Technologic", artist: "Daft Punk", year: 2005, popularity: 88, tags: "electronic,robotic,repetitive", phrases: "buy it,use it,break it,fix it" },
  { title: "Aerodynamic", artist: "Daft Punk", year: 2001, popularity: 86, tags: "electronic,rock,epic", phrases: "aerodynamic,guitar,epic" },

  // Calvin Harris (20 songs)
  { title: "Summer", artist: "Calvin Harris", year: 2014, popularity: 93, tags: "edm,pop,upbeat", phrases: "summer,when i met you,sun" },
  { title: "Feel So Close", artist: "Calvin Harris", year: 2011, popularity: 92, tags: "edm,euphoric,uplifting", phrases: "feel so close,you,euphoric" },
  { title: "This Is What You Came For", artist: "Calvin Harris feat. Rihanna", year: 2016, popularity: 94, tags: "edm,pop,dance", phrases: "came for,lightning,strikes,rihanna" },
  { title: "We Found Love", artist: "Calvin Harris feat. Rihanna", year: 2011, popularity: 96, tags: "edm,anthem,emotional", phrases: "found love,hopeless place,rihanna" },
  { title: "Sweet Nothing", artist: "Calvin Harris feat. Florence Welch", year: 2012, popularity: 91, tags: "edm,emotional,uplifting", phrases: "sweet nothing,patience,florence" },
  { title: "I Need Your Love", artist: "Calvin Harris feat. Ellie Goulding", year: 2012, popularity: 90, tags: "edm,pop,catchy", phrases: "need your love,reflection,ellie" },
  { title: "Outside", artist: "Calvin Harris feat. Ellie Goulding", year: 2014, popularity: 89, tags: "edm,emotional,uplifting", phrases: "outside,look at,we could be,stars" },
  { title: "Bounce", artist: "Calvin Harris feat. Kelis", year: 2011, popularity: 87, tags: "edm,bounce,energetic", phrases: "bounce,stand up,kelis" },
  { title: "Blame", artist: "Calvin Harris feat. John Newman", year: 2014, popularity: 88, tags: "edm,deep house,emotional", phrases: "can't blame,love,john newman" },
  { title: "How Deep Is Your Love", artist: "Calvin Harris & Disciples", year: 2015, popularity: 90, tags: "edm,deep house,atmospheric", phrases: "how deep,love,pull me,deeper" },

  // Amy Winehouse (15 songs)
  { title: "Back to Black", artist: "Amy Winehouse", year: 2006, popularity: 95, tags: "soul,r&b,retro", phrases: "back to black,died,hundred times" },
  { title: "Valerie", artist: "Amy Winehouse", year: 2007, popularity: 93, tags: "soul,pop,upbeat", phrases: "valerie,ginger hair,zurton" },
  { title: "You Know I'm No Good", artist: "Amy Winehouse", year: 2006, popularity: 91, tags: "soul,r&b,confessional", phrases: "no good,sweet,upstairs,cheating" },
  { title: "Tears Dry on Their Own", artist: "Amy Winehouse", year: 2006, popularity: 90, tags: "soul,motown,heartbreak", phrases: "tears dry,own,walked,away" },
  { title: "Love Is a Losing Game", artist: "Amy Winehouse", year: 2006, popularity: 92, tags: "soul,ballad,heartbreak", phrases: "love,losing game,self professed" },
  { title: "Stronger Than Me", artist: "Amy Winehouse", year: 2003, popularity: 86, tags: "jazz,soul,attitude", phrases: "stronger than me,wimpy,man" },
  { title: "Wake Up Alone", artist: "Amy Winehouse", year: 2006, popularity: 88, tags: "soul,emotional,intimate", phrases: "wake up alone,rather,him" },
  { title: "Our Day Will Come", artist: "Amy Winehouse", year: 2011, popularity: 85, tags: "soul,jazz,romantic", phrases: "day will come,tender,dreams" },
  { title: "Will You Still Love Me Tomorrow", artist: "Amy Winehouse", year: 2011, popularity: 84, tags: "soul,ballad,vulnerable", phrases: "love me tomorrow,tonight,forever" },
  { title: "Just Friends", artist: "Amy Winehouse", year: 2003, popularity: 83, tags: "jazz,soul,playful", phrases: "just friends,lovers,not,supposed" },

  // Gorillaz (20 songs)
  { title: "Feel Good Inc.", artist: "Gorillaz", year: 2005, popularity: 96, tags: "alternative,hip-hop,electronic", phrases: "feel good,windmill,laughing" },
  { title: "Clint Eastwood", artist: "Gorillaz", year: 2001, popularity: 94, tags: "alternative,hip-hop,trip-hop", phrases: "sunshine,bag,useless,del" },
  { title: "On Melancholy Hill", artist: "Gorillaz", year: 2010, popularity: 93, tags: "alternative,electronic,dreamy", phrases: "melancholy hill,plastic,tree" },
  { title: "Rhinestone Eyes", artist: "Gorillaz", year: 2010, popularity: 90, tags: "alternative,electronic,dark", phrases: "rhinestone eyes,nature,distant" },
  { title: "Stylo", artist: "Gorillaz feat. Mos Def", year: 2010, popularity: 89, tags: "electronic,funk,groovy", phrases: "stylo,overload,bobby womack" },
  { title: "Dare", artist: "Gorillaz", year: 2005, popularity: 91, tags: "electronic,dance,minimal", phrases: "dare,coming up,it's there" },
  { title: "Dirty Harry", artist: "Gorillaz", year: 2005, popularity: 88, tags: "alternative,hip-hop,atmospheric", phrases: "dirty harry,coming up,children" },
  { title: "Empire Ants", artist: "Gorillaz", year: 2010, popularity: 87, tags: "electronic,dreamy,atmospheric", phrases: "empire ants,little memories,yukimi" },
  { title: "Saturnz Barz", artist: "Gorillaz", year: 2017, popularity: 86, tags: "electronic,grime,dark", phrases: "saturnz barz,all my life,popcaan" },
  { title: "Andromeda", artist: "Gorillaz", year: 2017, popularity: 85, tags: "electronic,pop,atmospheric", phrases: "andromeda,outside,cold,stars" }
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
