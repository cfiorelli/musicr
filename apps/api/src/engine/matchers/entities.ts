/**
 * Named Entity Extractor
 * 
 * Simple regex and wordlist-based entity recognition for cities, temporal
 * references, weather, and other contextual elements that can boost song relevance.
 */

import { logger } from '../../config/index.js';

export interface ExtractedEntities {
  cities: string[];
  countries: string[];
  temporal: string[];      // day names, times, seasons
  weather: string[];       // weather conditions
  relationships: string[]; // relationship keywords
  activities: string[];    // activities and actions
  emotions: string[];      // emotion words not caught by mood
  colors: string[];        // color references
  numbers: string[];       // significant numbers
}

export interface EntityConfig {
  enabled: boolean;
  city_boost: number;
  temporal_boost: number;
  weather_boost: number;
  case_sensitive?: boolean;
}

export class EntityExtractor {
  private config: EntityConfig;
  
  // Entity wordlists and patterns
  private entityLists = {
    cities: [
      // Major US cities
      'new york', 'los angeles', 'chicago', 'houston', 'philadelphia', 'phoenix',
      'san antonio', 'san diego', 'dallas', 'san jose', 'austin', 'jacksonville',
      'fort worth', 'columbus', 'charlotte', 'seattle', 'denver', 'boston',
      'detroit', 'nashville', 'memphis', 'portland', 'las vegas', 'louisville',
      'baltimore', 'milwaukee', 'albuquerque', 'tucson', 'fresno', 'sacramento',
      'atlanta', 'kansas city', 'colorado springs', 'miami', 'raleigh', 'omaha',
      'long beach', 'virginia beach', 'oakland', 'minneapolis', 'tampa',
      'tulsa', 'new orleans', 'honolulu', 'anaheim', 'aurora', 'santa ana',
      'st. louis', 'riverside', 'corpus christi', 'lexington', 'pittsburgh',
      'anchorage', 'stockton', 'cincinnati', 'st. paul', 'toledo', 'newark',
      
      // Major world cities
      'london', 'paris', 'berlin', 'madrid', 'rome', 'amsterdam', 'vienna',
      'prague', 'budapest', 'warsaw', 'stockholm', 'oslo', 'copenhagen',
      'helsinki', 'dublin', 'edinburgh', 'glasgow', 'manchester', 'liverpool',
      'tokyo', 'osaka', 'kyoto', 'seoul', 'beijing', 'shanghai', 'hong kong',
      'singapore', 'bangkok', 'kuala lumpur', 'jakarta', 'manila', 'mumbai',
      'delhi', 'bangalore', 'chennai', 'kolkata', 'sydney', 'melbourne',
      'brisbane', 'perth', 'auckland', 'wellington', 'toronto', 'vancouver',
      'montreal', 'ottawa', 'calgary', 'edmonton', 'winnipeg', 'quebec city',
      'mexico city', 'guadalajara', 'monterrey', 'puebla', 'tijuana', 'león',
      'buenos aires', 'córdoba', 'rosario', 'mendoza', 'san miguel', 'salta',
      'são paulo', 'rio de janeiro', 'salvador', 'brasília', 'fortaleza', 'belo horizonte',
      'cairo', 'alexandria', 'giza', 'casablanca', 'fez', 'marrakech',
      'johannesburg', 'cape town', 'durban', 'pretoria', 'nairobi', 'lagos'
    ],
    
    countries: [
      'usa', 'america', 'united states', 'canada', 'mexico', 'brazil', 'argentina',
      'uk', 'england', 'britain', 'scotland', 'wales', 'ireland', 'france', 'germany',
      'italy', 'spain', 'portugal', 'netherlands', 'belgium', 'switzerland', 'austria',
      'sweden', 'norway', 'denmark', 'finland', 'poland', 'czech republic', 'hungary',
      'russia', 'china', 'japan', 'korea', 'india', 'thailand', 'vietnam', 'singapore',
      'australia', 'new zealand', 'south africa', 'egypt', 'morocco', 'nigeria'
    ],

    temporal: [
      // Days of the week
      'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
      'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun',
      'weekend', 'weekday', 'weeknight', 'workday',
      
      // Times of day
      'morning', 'afternoon', 'evening', 'night', 'midnight', 'noon', 'dawn', 'dusk',
      'sunrise', 'sunset', 'daybreak', 'twilight', 'am', 'pm',
      
      // Seasons
      'spring', 'summer', 'autumn', 'fall', 'winter',
      
      // Months
      'january', 'february', 'march', 'april', 'may', 'june',
      'july', 'august', 'september', 'october', 'november', 'december',
      'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
      
      // Time references
      'today', 'yesterday', 'tomorrow', 'tonight', 'now', 'then', 'soon', 'later',
      'early', 'late', 'before', 'after', 'during', 'while'
    ],

    weather: [
      'sunny', 'cloudy', 'rainy', 'stormy', 'snowy', 'foggy', 'misty', 'hazy',
      'clear', 'overcast', 'drizzle', 'shower', 'thunderstorm', 'lightning',
      'thunder', 'rainbow', 'wind', 'windy', 'breeze', 'breezy', 'calm',
      'hot', 'warm', 'cool', 'cold', 'freezing', 'humid', 'dry',
      'rain', 'snow', 'hail', 'sleet', 'ice', 'frost', 'dew',
      'storm', 'hurricane', 'tornado', 'blizzard', 'flood'
    ],

    relationships: [
      'love', 'lover', 'boyfriend', 'girlfriend', 'husband', 'wife', 'partner',
      'relationship', 'dating', 'married', 'single', 'crush', 'romance', 'romantic',
      'breakup', 'ex', 'divorce', 'separation', 'together', 'apart',
      'family', 'mother', 'father', 'mom', 'dad', 'parents', 'child', 'children',
      'son', 'daughter', 'brother', 'sister', 'sibling', 'cousin', 'uncle', 'aunt',
      'grandmother', 'grandfather', 'grandma', 'grandpa', 'grandparents',
      'friend', 'friends', 'friendship', 'buddy', 'pal', 'mate',
      'heart', 'heartbreak', 'soul', 'soulmate', 'valentine', 'wedding', 'anniversary'
    ],

    activities: [
      'driving', 'walking', 'running', 'dancing', 'singing', 'playing', 'working',
      'studying', 'reading', 'writing', 'cooking', 'eating', 'drinking', 'sleeping',
      'shopping', 'traveling', 'vacation', 'holiday', 'party', 'celebration',
      'concert', 'movie', 'theater', 'restaurant', 'bar', 'club', 'gym', 'sport',
      'exercise', 'workout', 'game', 'competition', 'race', 'match',
      'meeting', 'date', 'appointment', 'interview', 'presentation', 'conference',
      'school', 'work', 'office', 'home', 'house', 'car', 'train', 'plane', 'bus'
    ],

    emotions: [
      'happy', 'sad', 'angry', 'excited', 'nervous', 'anxious', 'worried', 'scared',
      'afraid', 'confident', 'proud', 'embarrassed', 'ashamed', 'guilty', 'jealous',
      'envious', 'grateful', 'thankful', 'hopeful', 'disappointed', 'frustrated',
      'annoyed', 'irritated', 'confused', 'surprised', 'shocked', 'amazed',
      'impressed', 'inspired', 'motivated', 'determined', 'focused', 'relaxed',
      'peaceful', 'calm', 'stressed', 'overwhelmed', 'tired', 'energetic',
      'bored', 'interested', 'curious', 'passionate', 'enthusiastic'
    ],

    colors: [
      'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'brown',
      'black', 'white', 'gray', 'grey', 'gold', 'silver', 'bronze',
      'crimson', 'scarlet', 'maroon', 'navy', 'turquoise', 'cyan', 'teal',
      'lime', 'forest', 'olive', 'amber', 'beige', 'tan', 'cream', 'ivory',
      'violet', 'indigo', 'magenta', 'rose', 'coral', 'salmon'
    ]
  };

  private numberPattern = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion)\b/gi;

  constructor(config: EntityConfig) {
    this.config = {
      case_sensitive: false,
      ...config
    };
  }

  /**
   * Extract named entities from a message
   */
  async extractEntities(message: string): Promise<ExtractedEntities> {
    if (!this.config.enabled) {
      return this.getEmptyEntities();
    }

    try {
      logger.debug({ message: message.substring(0, 100) }, 'Extracting entities');

      const processedMessage = this.config.case_sensitive ? message : message.toLowerCase();

      const entities: ExtractedEntities = {
        cities: this.findEntities(processedMessage, this.entityLists.cities),
        countries: this.findEntities(processedMessage, this.entityLists.countries),
        temporal: this.findEntities(processedMessage, this.entityLists.temporal),
        weather: this.findEntities(processedMessage, this.entityLists.weather),
        relationships: this.findEntities(processedMessage, this.entityLists.relationships),
        activities: this.findEntities(processedMessage, this.entityLists.activities),
        emotions: this.findEntities(processedMessage, this.entityLists.emotions),
        colors: this.findEntities(processedMessage, this.entityLists.colors),
        numbers: this.extractNumbers(message)
      };

      const totalEntities = Object.values(entities).reduce((sum, arr) => sum + arr.length, 0);
      
      logger.debug({
        totalEntities,
        cities: entities.cities.length,
        temporal: entities.temporal.length,
        weather: entities.weather.length,
        relationships: entities.relationships.length
      }, 'Entity extraction completed');

      return entities;

    } catch (error) {
      logger.warn({ error, message }, 'Entity extraction failed');
      return this.getEmptyEntities();
    }
  }

  /**
   * Find entities of a specific type in the message
   */
  private findEntities(message: string, entityList: string[]): string[] {
    const found: string[] = [];
    
    for (const entity of entityList) {
      // Check for exact word boundaries to avoid partial matches
      const regex = new RegExp(`\\b${entity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      if (regex.test(message)) {
        found.push(entity);
      }
    }
    
    return [...new Set(found)]; // Remove duplicates
  }

  /**
   * Extract number references from the message
   */
  private extractNumbers(message: string): string[] {
    const matches = message.match(this.numberPattern);
    return matches ? [...new Set(matches)] : [];
  }

  /**
   * Get contextual boost score for a song based on extracted entities
   */
  calculateEntityBoost(songTags: string[], entities: ExtractedEntities): number {
    let boost = 0;

    // City boost
    if (entities.cities.length > 0) {
      const cityMatches = songTags.some(tag => 
        entities.cities.some(city => 
          tag.toLowerCase().includes(city.toLowerCase())
        )
      );
      if (cityMatches) boost += this.config.city_boost;
    }

    // Temporal boost
    if (entities.temporal.length > 0) {
      const timeMatches = songTags.some(tag => 
        entities.temporal.some(time => 
          tag.toLowerCase().includes(time.toLowerCase())
        )
      );
      if (timeMatches) boost += this.config.temporal_boost;
    }

    // Weather boost
    if (entities.weather.length > 0) {
      const weatherMatches = songTags.some(tag => 
        entities.weather.some(weather => 
          tag.toLowerCase().includes(weather.toLowerCase())
        )
      );
      if (weatherMatches) boost += this.config.weather_boost;
    }

    return boost;
  }

  /**
   * Analyze entity patterns for insights
   */
  analyzeEntityPatterns(entities: ExtractedEntities): {
    hasLocationContext: boolean;
    hasTimeContext: boolean;
    hasEmotionalContext: boolean;
    hasActivityContext: boolean;
    contextStrength: number; // 0-1 scale
  } {
    const locationCount = entities.cities.length + entities.countries.length;
    const timeCount = entities.temporal.length;
    const emotionalCount = entities.emotions.length + entities.relationships.length;
    const activityCount = entities.activities.length;

    const totalEntities = locationCount + timeCount + emotionalCount + activityCount;

    return {
      hasLocationContext: locationCount > 0,
      hasTimeContext: timeCount > 0,
      hasEmotionalContext: emotionalCount > 0,
      hasActivityContext: activityCount > 0,
      contextStrength: Math.min(1.0, totalEntities / 10) // Normalize to 0-1
    };
  }

  /**
   * Get empty entities object
   */
  private getEmptyEntities(): ExtractedEntities {
    return {
      cities: [],
      countries: [],
      temporal: [],
      weather: [],
      relationships: [],
      activities: [],
      emotions: [],
      colors: [],
      numbers: []
    };
  }

  /**
   * Get entity extraction statistics
   */
  getEntityStats(): {
    totalEntities: Record<string, number>;
    isEnabled: boolean;
    config: EntityConfig;
  } {
    const totalEntities: Record<string, number> = {};
    
    for (const [type, list] of Object.entries(this.entityLists)) {
      totalEntities[type] = list.length;
    }

    return {
      totalEntities,
      isEnabled: this.config.enabled,
      config: this.config
    };
  }

  /**
   * Health check for entity extractor
   */
  isHealthy(): boolean {
    return this.config.enabled && Object.keys(this.entityLists).length > 0;
  }

  /**
   * Add custom entities to a specific category
   */
  addCustomEntities(category: keyof typeof this.entityLists, entities: string[]): void {
    if (category in this.entityLists) {
      this.entityLists[category].push(...entities);
      // Remove duplicates
      this.entityLists[category] = [...new Set(this.entityLists[category])];
      
      logger.info({ 
        category, 
        addedCount: entities.length,
        totalCount: this.entityLists[category].length 
      }, 'Added custom entities');
    }
  }
}