/// <reference types="vite/client" />
//
// Declares Vite's ambient module types, including the `*.css` side-effect
// import in main.tsx. TypeScript 6 reports those as TS2882 without it;
// earlier versions let them pass silently, which is why this file was
// never needed before.
