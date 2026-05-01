import 'dotenv/config';
import { prisma } from '../src/services/database.js';
import { logger } from '../src/config/index.js';
import { containsBlockedKeyword, getBlockedKeywordCount } from '../src/utils/content-filter.js';

const FALLBACK_PROFANITY_PATTERNS: RegExp[] = [
  /\bshit\b/i,
  /\bfuck\b/i,
  /\bbitch\b/i,
  /\basshole\b/i,
  /\bcunt\b/i,
  /\bdick\b/i,
  /\bnigg(?:er|a)\b/i,
];

const isDisallowedText = (text: string): boolean => (
  containsBlockedKeyword(text) || FALLBACK_PROFANITY_PATTERNS.some((re) => re.test(text))
);

interface ScanResult {
  scanned: number;
  matched: number;
  deleted: number;
}

function parseArgs() {
  const args = new Set(process.argv.slice(2));
  return {
    dryRun: args.has('--dry-run'),
    purgeAll: args.has('--all')
  };
}

async function scanOffensiveMessages(batchSize = 1000): Promise<string[]> {
  const matchingIds: string[] = [];
  let cursorId: string | undefined;

  while (true) {
    const messages = await prisma.message.findMany({
      select: {
        id: true,
        text: true
      },
      orderBy: {
        id: 'asc'
      },
      take: batchSize,
      ...(cursorId
        ? {
            cursor: { id: cursorId },
            skip: 1
          }
        : {})
    });

    if (messages.length === 0) break;

    for (const msg of messages) {
      if (isDisallowedText(msg.text)) {
        matchingIds.push(msg.id);
      }
    }

    cursorId = messages[messages.length - 1].id;
  }

  return matchingIds;
}

async function deleteByIds(ids: string[], chunkSize = 500): Promise<number> {
  let deleted = 0;

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const result = await prisma.message.deleteMany({
      where: {
        id: { in: chunk }
      }
    });
    deleted += result.count;
  }

  return deleted;
}

async function getTotalMessageCount(): Promise<number> {
  return prisma.message.count();
}

async function run(): Promise<ScanResult> {
  const { dryRun, purgeAll } = parseArgs();
  const keywordCount = getBlockedKeywordCount();

  await prisma.$connect();

  try {
    const totalBefore = await getTotalMessageCount();

    logger.info({
      totalMessages: totalBefore,
      keywordCount,
      dryRun,
      purgeAll
    }, 'Starting offensive history cleanup');

    if (!purgeAll && keywordCount === 0) {
      logger.warn('No BLOCKED_KEYWORDS configured. Falling back to built-in profanity list only.');
    }

    if (purgeAll) {
      if (dryRun) {
        logger.info({ wouldDelete: totalBefore }, 'Dry run: full purge requested');
        return { scanned: totalBefore, matched: totalBefore, deleted: 0 };
      }

      const result = await prisma.message.deleteMany({ where: {} });
      const totalAfter = await getTotalMessageCount();
      logger.info({
        deleted: result.count,
        totalAfter
      }, 'Completed full history purge');
      return { scanned: totalBefore, matched: totalBefore, deleted: result.count };
    }

    const ids = await scanOffensiveMessages();

    if (dryRun) {
      logger.info({
        scanned: totalBefore,
        matched: ids.length,
        deleted: 0
      }, 'Dry run complete');
      return { scanned: totalBefore, matched: ids.length, deleted: 0 };
    }

    const deleted = await deleteByIds(ids);
    const totalAfter = await getTotalMessageCount();

    logger.info({
      scanned: totalBefore,
      matched: ids.length,
      deleted,
      totalAfter
    }, 'Offensive history cleanup complete');

    return {
      scanned: totalBefore,
      matched: ids.length,
      deleted
    };
  } finally {
    await prisma.$disconnect();
  }
}

run()
  .then((result) => {
    logger.info(result, 'Cleanup summary');
  })
  .catch((error) => {
    logger.error({ error }, 'Offensive history cleanup failed');
    process.exit(1);
  });
