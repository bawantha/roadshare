import { Routes } from '@angular/router';
import { HomeComponent } from './components/home/home.component';
import { TripsComponent } from './components/trips/trips.component';
import { DriveComponent } from './components/drive/drive.component';
import { BookingsComponent } from './components/bookings/bookings.component';
import { AuthComponent } from './components/auth/auth.component';
import { inject } from '@angular/core';
import { SupabaseService } from './services/supabase.service';
import { Router } from '@angular/router';

const authGuard = () => {
  const supabaseService = inject(SupabaseService);
  const router = inject(Router);
  if (supabaseService.currentUser()) {
    return true;
  }
  // Redirect to Auth page
  return router.parseUrl('/auth');
};

export const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'trips', component: TripsComponent },
  { path: 'drive', component: DriveComponent, canActivate: [authGuard] },
  { path: 'bookings', component: BookingsComponent, canActivate: [authGuard] },
  { path: 'auth', component: AuthComponent },
  { path: '**', redirectTo: '' }
];
