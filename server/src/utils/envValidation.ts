interface EnvironmentConfig {
  DATABASE_URL: string;
  PORT: number;
  CLIENT_URL: string;
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

  if (!process.env.METADATA_ENCRYPTION_KEY) {
    warnings.push('METADATA_ENCRYPTION_KEY is missing. Using a temporary random key. Encrypted data will be lost on restart.');
  }

  if (errors.length > 0) {
    console.error('\nEnvironment Configuration Errors:');
    errors.forEach(err => console.error(`  - ${err}`));
    console.error('\nPlease check your .env file and ensure all required variables are set correctly.\n');
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.warn('\nEnvironment Configuration Warnings:');
    warnings.forEach(warn => console.warn(`  - ${warn}`));
    console.warn('');
  }

  console.log('Environment variables validated successfully');
  if (process.env.NODE_ENV === 'production') {
    console.log('Running in PRODUCTION mode');
  } else {
    console.log('Running in DEVELOPMENT mode');
  }

  return {
    DATABASE_URL: process.env.DATABASE_URL!,
    PORT: port,
    CLIENT_URL: clientUrl,
    NODE_ENV: process.env.NODE_ENV || 'development',
  };
}
