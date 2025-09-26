# Musicr

A music-themed chat website where anonymous users chat with each other, but their messages are converted to relevant song titles using AI.

## Features

- Anonymous real-time chat via WebSocket
- AI-powered message to song title conversion
- Modern React frontend with Tailwind CSS
- TypeScript monorepo with shared types
- Fastify backend with Prisma database

## Tech Stack

### Backend (`apps/api`)
- **Fastify** - Fast web framework
- **@fastify/websocket** - WebSocket support
- **Prisma** - Database ORM
- **Zod** - Schema validation
- **OpenAI** - AI song title generation
- **@huggingface/transformers** - Alternative AI processing
- **Pino** - Structured logging

### Frontend (`apps/web`)
- **Vite** - Build tool
- **React 18** - UI framework
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **Zustand** - State management

### Shared (`shared/types`)
- **TypeScript** - Shared types and interfaces

## Project Structure

```
musicr/
├── apps/
│   ├── api/          # Fastify backend
│   └── web/          # React frontend
├── shared/
│   └── types/        # Shared TypeScript types
├── package.json      # Root package.json with workspace config
└── pnpm-workspace.yaml
```

## Development

### Prerequisites
- Node.js 20+
- pnpm 8+
- PostgreSQL 14+ with pgvector extension

## 🚀 Quick Start

### Option 1: One-Command Docker Deployment (Recommended)
```bash
# Clone and deploy everything with Docker
git clone <repository-url>
cd musicr
./deploy.sh
```

That's it! The application will be running at:
- **Frontend**: http://localhost:5173
- **API**: http://localhost:4000
- **Health Check**: http://localhost:4000/health

See [DEPLOYMENT.md](DEPLOYMENT.md) for complete deployment documentation.

### Option 2: Local Development Setup

### Installation

```bash
# Install all dependencies
pnpm install

# Set up environment files
cp apps/api/.env.example apps/api/.env
```

### Running the project

```bash
# Start both API and web in development mode
pnpm dev

# Or start them separately:
pnpm --filter @musicr/api dev    # API on http://localhost:3001
pnpm --filter @musicr/web dev    # Web on http://localhost:3000
```

### Building

```bash
# Build all packages
pnpm build

# Build specific package
pnpm --filter @musicr/api build
pnpm --filter @musicr/web build
```

### Other Commands

```bash
# Lint all packages
pnpm lint

# Run tests
pnpm test

# Clean build artifacts
pnpm clean
```

## Environment Variables

### API (`apps/api/.env`)

```env
NODE_ENV=development
PORT=3001
HOST=localhost
DATABASE_URL="file:./dev.db"
OPENAI_API_KEY=your_openai_api_key_here  # Optional
```

## 🎵 How Mapping Works

Musicr transforms your everyday messages into relevant songs using a sophisticated AI-powered mapping system. Here's how it works:

### The Process

1. **Text Analysis** - Your message is analyzed for emotional context, keywords, and intent
2. **Strategy Selection** - The system chooses the best matching strategy (exact phrase, semantic similarity, or mood mapping)
3. **Song Retrieval** - Relevant songs are found from our curated database
4. **Confidence Scoring** - Each match is scored based on relevance and context
5. **Result Selection** - The highest confidence match is returned, with alternatives for close calls

### Mapping Strategies

#### 1. **Exact Match** (Highest Confidence)
Direct phrase matches from song lyrics or titles:

```
"hey jude" → "Hey Jude" by The Beatles
"bohemian rhapsody" → "Bohemian Rhapsody" by Queen  
"shake it off" → "Shake It Off" by Taylor Swift
```

#### 2. **Semantic Similarity** (Medium-High Confidence)
AI understands context and emotional meaning:

```
"running late, train delayed" → "Waiting on the World to Change" by John Mayer
"I got promoted!" → "Good Life" by OneRepublic
"feeling lonely tonight" → "Somebody That I Used to Know" by Gotye
"stuck in traffic jam" → "Don't Stop Believin'" by Journey
```

#### 3. **Mood Mapping** (Medium Confidence)
Emotional context drives song selection:

```
"celebrating my birthday" → "Dancing Queen" by ABBA
"she broke up with me" → "Rolling in the Deep" by Adele
"perfect sunny day" → "Happy" by Pharrell Williams
"stressed about work" → "Stressed Out" by Twenty One Pilots
```

### Real Examples

#### Simple Cases
```
Input: "just got engaged!"
→ Song: "Dancing Queen" by ABBA
→ Strategy: mood (celebration)
→ Confidence: 87%
```

#### Complex Cases with Tie-Breaking
```
Input: "We need to talk"
→ Primary: "Since U Been Gone" by Kelly Clarkson (confidence: 76%)
→ Alternative: "Irreplaceable" by Beyoncé (confidence: 74%)

Why "Since U Been Gone" won:
• Higher semantic similarity to relationship confrontation
• More direct lyrical connection to difficult conversations
• Stronger association with relationship endings in our training data
```

#### Context-Aware Mapping
```
Input: "california dreaming again"
→ Song: "Hotel California" by Eagles
→ Strategy: semantic + geographic
→ Confidence: 92%

The system recognized:
• Geographic reference (California)
• Nostalgic emotional tone ("dreaming")
• Cultural association with classic rock
```

#### Ambiguous Input Resolution
```
Input: "love song"
→ Primary: "I Want It That Way" by Backstreet Boys (confidence: 45%)
→ Alternatives: 12 other love songs

Low confidence indicates multiple valid matches:
• "Shape of You" by Ed Sheeran (confidence: 44%)
• "Perfect" by Ed Sheeran (confidence: 43%)
• "All of Me" by John Legend (confidence: 42%)
```

### Confidence Scoring

- **90-100%**: Exact phrase match or unmistakable context
- **75-89%**: Strong semantic similarity, clear intent
- **60-74%**: Good contextual match, some ambiguity
- **45-59%**: Multiple valid interpretations
- **Below 45%**: Fallback to popular/generic songs

### Edge Cases & Limitations

#### What Works Well
✅ Emotional expressions: "feeling happy", "so sad"  
✅ Life events: "got married", "new job"  
✅ Weather/mood: "sunny day", "rainy mood"  
✅ Direct song references: "hey jude", "bohemian"  

#### Challenging Cases
⚠️ Abstract concepts: "quantum physics breakthrough"  
⚠️ Very specific scenarios: "left my keys in the car"  
⚠️ Cultural references: "like Shakespeare said"  
⚠️ Technical language: "API endpoint returning 404"  

#### Fallback Behavior
When confidence is very low, the system falls back to:
1. Popular songs from relevant genres
2. Mood-appropriate selections
3. Generic crowd-pleasers like "Don't Stop Believin'"

### System Learning
The mapping system continuously improves through:
- **Usage patterns**: Popular mappings get reinforced
- **Context analysis**: Better understanding of phrase meanings  
- **Cultural updates**: New songs and trends incorporated
- **Feedback loops**: User interactions inform future mappings

## API Endpoints

- `GET /health` - Health check
- `POST /api/map` - Map text to song (see mapping examples above)
- `GET /ws` - WebSocket connection for real-time chat

## WebSocket Events

### Client → Server
```json
{
  "message": "Hello, how are you?"
}
```

### Server → Client
```json
{
  "type": "message",
  "data": "♪ How You Remind Me - Nickelback ♪",
  "timestamp": "2025-01-01T12:00:00.000Z"
}
```

## License

MIT