/// <reference types="vite/client" />
declare module '../../public/pdf-header-plain.png?url' { const content: string; export default content; }
declare module '../assets/Logo.jpeg?url' { const content: string; export default content; }

declare const __APP_VERSION__: string
declare module 'xlsx/xlsx.mjs' { export * from 'xlsx' }

declare module '*.png?url' { const content: string; export default content; }
declare module '*.jpeg?url' { const content: string; export default content; }
declare module '*.jpg?url' { const content: string; export default content; }
declare module '*.svg?url' { const content: string; export default content; }

// Test declaration
declare module 'test-module' { const value: string; export default value; }
declare module 'non-existent-module' { const value: string; export default value; }
