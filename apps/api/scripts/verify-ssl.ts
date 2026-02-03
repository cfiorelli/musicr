import 'dotenv/config';
import { prisma } from '../src/services/database.js';
import { logger } from '../src/config/index.js';

/**
 * Verify SSL connection to PostgreSQL database
 */

async function verifySSL() {
  logger.info('🔐 Verifying SSL connection to database...\n');

  try {
    await prisma.$connect();

    // Check if SSL is being used
    const sslResult = await prisma.$queryRaw<Array<{ ssl: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM pg_stat_ssl WHERE ssl = true
      ) as ssl
    `;

    const isUsingSSL = sslResult[0]?.ssl;

    logger.info('=== SSL Status ===');
    logger.info(`DATABASE_URL: ${process.env.DATABASE_URL?.replace(/:[^:@]+@/, ':***@')}`);
    logger.info(`SSL in use: ${isUsingSSL ? '✅ Yes' : '❌ No'}`);

    // Get PostgreSQL version
    const versionResult = await prisma.$queryRaw<Array<{ version: string }>>`
      SELECT version()
    `;
    logger.info(`PostgreSQL: ${versionResult[0]?.version.split(',')[0]}`);

    // Check sslmode from connection string
    const sslMode = process.env.DATABASE_URL?.match(/sslmode=([^&]+)/)?.[1] || 'not specified';
    logger.info(`sslmode parameter: ${sslMode}`);

    logger.info('\n=== Recommendation ===');
    if (isUsingSSL) {
      logger.info('✅ SSL is active. Connection is encrypted.');
    } else {
      logger.warn('⚠️  SSL is NOT active. Connection is unencrypted.');
      logger.warn('   For production, update DATABASE_URL to use sslmode=require');
      logger.warn('   Example: postgresql://user:pass@host:port/db?sslmode=require');
    }

    // Exit with appropriate code
    if (process.env.NODE_ENV === 'production' && !isUsingSSL) {
      logger.error('\n❌ SSL must be enabled in production!');
      process.exit(1);
    }

    logger.info('\n✅ SSL verification complete!');
    process.exit(0);

  } catch (error: any) {
    logger.error({ error: error.message }, '❌ SSL verification failed');
    logger.error('If using sslmode=require, ensure your database supports SSL');
    logger.error('Try sslmode=prefer as a fallback for debugging');
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

verifySSL();
