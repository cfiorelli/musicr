declare module 'vader-sentiment' {
  export class SentimentAnalyzer {
    constructor(language: string, stemmer: any, lexicon: string);
    getSentiment(words: string[]): {
      compound: number;
      pos: number;
      neg: number;
      neu: number;
    };
  }
  
  export const PorterStemmer: any;
}