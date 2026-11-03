import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.cuidar.gerencial',
  appName: 'Cuidar Gerencial',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: true,
  },
  android: {
    backgroundColor: '#FFFFFF',
    allowMixedContent: true,
  },
}

export default config

