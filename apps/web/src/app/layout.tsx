import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/auth-context';

export const metadata: Metadata = {
  title: 'DRep DAO',
  description: 'Cardano governance DAO platform',
};

// Swallow errors thrown by browser extensions (MetaMask, etc.) injected into the
// page — they come from chrome-extension:// scripts, not our code, and would
// otherwise trip the Next dev error overlay. Registered before Next's handlers
// (inline, capture phase) so it can stop them; never matches real app errors.
const EXT_ERROR_GUARD = `(function(){
  var ext=function(s){return !!s&&(s.indexOf('chrome-extension://')>=0||s.indexOf('moz-extension://')>=0);};
  window.addEventListener('error',function(e){if(ext(e.filename)||(e.error&&ext(e.error.stack))){e.stopImmediatePropagation();e.preventDefault();}},true);
  window.addEventListener('unhandledrejection',function(e){var r=e.reason;var s=(r&&(r.stack||r.message))||String(r||'');if(ext(s)||/Failed to connect to MetaMask/i.test(s)){e.stopImmediatePropagation();e.preventDefault();}},true);
})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      {/* suppressHydrationWarning: browser extensions (Grammarly, etc.) inject
          attributes on <body> before React hydrates — harmless, not our markup. */}
      <body
        suppressHydrationWarning
        className="min-h-screen bg-neutral-50 text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100"
      >
        {/* eslint-disable-next-line @next/next/no-before-interactive-script-outside-document */}
        <script dangerouslySetInnerHTML={{ __html: EXT_ERROR_GUARD }} />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
