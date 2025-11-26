import { logger } from './logger.js';

interface EnvironmentConfig {
  DATABASE_URL: string;
  ENCRYPTION_KEY: string;
  PORT: number;
  TURN_SERVER: string | undefined;
  TURN_SECRET: string | undefined;
  TURNS_ENABLED: boolean;
  NODE_ENV: string;
}

export function validateEnvironment(): EnvironmentConfig {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required variables
  if (!process.env.DATABASE_URL) {
    errors.push('DATABASE_URL is required');
  } else if (!process.env.DATABASE_URL.startsWith('postgresql://') && !process.env.DATABASE_URL.startsWith('postgres://')) {
    warnings.push('DATABASE_URL does not appear to be a valid PostgreSQL connection string');
  }

  if (!process.env.ENCRYPTION_KEY) {
    errors.push('ENCRYPTION_KEY is required');
  } else if (process.env.ENCRYPTION_KEY.length < 32) {
    errors.push('ENCRYPTION_KEY must be at least 32 characters long');
  } else if (process.env.ENCRYPTION_KEY.length < 64) {
    warnings.push('ENCRYPTION_KEY should be at least 64 characters for maximum security');
  }

  // Port validation
  const port = parseInt(process.env.PORT || '4000', 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    errors.push('PORT must be a valid number between 1 and 65535');
  }

  // TURN server validation (optional but warn if incomplete)
  const hasTurnServer = !!process.env.TURN_SERVER;
  const hasTurnSecret = !!process.env.TURN_SECRET;
  
  if (hasTurnServer && !hasTurnSecret) {
    warnings.push('TURN_SERVER is set but TURN_SECRET is missing. TURN authentication will not work.');
  }
  
  if (!hasTurnServer && hasTurnSecret) {
    warnings.push('TURN_SECRET is set but TURN_SERVER is missing. TURN server will not be used.');
  }

  if (!hasTurnServer && !hasTurnSecret) {
    warnings.push('TURN server not configured. Using only public STUN server. WebRTC may fail behind restrictive NATs.');
  }

  // NODE_ENV validation
  if (process.env.NODE_ENV === 'production') {
    if (process.env.ENCRYPTION_KEY === 'dev-only-insecure-key-change-in-production-minimum-32-chars-required') {
      errors.push('Cannot use development ENCRYPTION_KEY in production environment');
    }
    
    if (!hasTurnServer || !hasTurnSecret) {
      warnings.push('Production deployment without TURN server may result in connection failures for users behind firewalls');
    }
  }

  // Log results
  if (errors.length > 0) {
    logger.log('error', 'Environment validation failed', { details: errors });
    console.error('\n❌ Environment Configuration Errors:');
    errors.forEach(err => console.error(`  - ${err}`));
    console.error('\nPlease check your .env file and ensure all required variables are set correctly.\n');
    process.exit(1);
  }

  if (warnings.length > 0) {
    logger.log('warn', 'Environment validation warnings', { details: warnings });
    console.warn('\n⚠️  Environment Configuration Warnings:');
    warnings.forEach(warn => console.warn(`  - ${warn}`));
    console.warn('');
  }

  // Success message
  console.log('✅ Environment variables validated successfully');
  if (process.env.NODE_ENV === 'production') {
    console.log('🚀 Running in PRODUCTION mode');
  } else {
    console.log('🔧 Running in DEVELOPMENT mode');
  }

  return {
    DATABASE_URL: process.env.DATABASE_URL!,
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY!,
    PORT: port,
    TURN_SERVER: process.env.TURN_SERVER || undefined,
    TURN_SECRET: process.env.TURN_SECRET || undefined,
    TURNS_ENABLED: process.env.TURNS_ENABLED === 'true',
    NODE_ENV: process.env.NODE_ENV || 'development',
  };
}
