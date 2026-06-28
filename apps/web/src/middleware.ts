import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const maintenanceMode = process.env.NEXT_PUBLIC_MAINTENANCE_MODE === 'true';

  if (maintenanceMode) {
    const url = request.nextUrl.clone();
    
    // Check if it's the maintenance page itself
    if (url.pathname === '/maintenance') {
      return NextResponse.next();
    }
    
    // Allow static files, image optimizations, and other assets to load properly
    const isAsset = 
      url.pathname.includes('/_next/') || 
      url.pathname.includes('/icon.png') || 
      url.pathname.includes('/opengraph-image.png') ||
      url.pathname.startsWith('/api/');

    if (!isAsset) {
      url.pathname = '/maintenance';
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

// Support running on all routes
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};
