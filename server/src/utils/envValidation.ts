interface EnvironmentConfig {
  DATABASE_URL: string;
  PORT: number;
  CLIENT_URL: string;
  TURN_SERVER: string | undefined;
  TURN_SECRET: string | undefined;
  TURNS_ENABLED: boolean;
  NODE_ENV: string;
}

export function validateEnvironment(): EnvironmentConfig {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!process.env.DATABASE_URL) {
    errors.push('DATABASE_URL is required');
  } else if (!process.env.DATABASE_URL.startsWith('postgresql://') && !process.env.DATABASE_URL.startsWith('postgres://')) {
    warnings.push('DATABASE_URL does not appear to be a valid PostgreSQL connection string');
  }

  const port = parseInt(process.env.PORT || '4000', 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    errors.push('PORT must be a valid number between 1 and 65535');
  }

  const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
  if (!clientUrl.startsWith('http://') && !clientUrl.startsWith('https://')) {
    warnings.push('CLIENT_URL should start with http:// or https://');
  }

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

  if (!process.env.METADATA_ENCRYPTION_KEY) {
    warnings.push('METADATA_ENCRYPTION_KEY is missing. Using a temporary random key. Encrypted data will be lost on restart.');
  }

  if (process.env.NODE_ENV === 'production') {
    if (!hasTurnServer || !hasTurnSecret) {
      warnings.push('Production deployment without TURN server may result in connection failures for users behind firewalls');
    }
  }

  if (errors.length > 0) {
    console.error('\n❌ Environment Configuration Errors:');
    errors.forEach(err => console.error(`  - ${err}`));
    console.error('\nPlease check your .env file and ensure all required variables are set correctly.\n');
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.warn('\n⚠️  Environment Configuration Warnings:');
    warnings.forEach(warn => console.warn(`  - ${warn}`));
    console.warn('');
  }

  console.log('✅ Environment variables validated successfully');
  if (process.env.NODE_ENV === 'production') {
    console.log('🚀 Running in PRODUCTION mode');
  } else {
    console.log('🔧 Running in DEVELOPMENT mode');
  }

  return {
    DATABASE_URL: process.env.DATABASE_URL!,
    PORT: port,
    CLIENT_URL: clientUrl,
    TURN_SERVER: process.env.TURN_SERVER || undefined,
    TURN_SECRET: process.env.TURN_SECRET || undefined,
    TURNS_ENABLED: process.env.TURNS_ENABLED === 'true',
    NODE_ENV: process.env.NODE_ENV || 'development',
  };
}
