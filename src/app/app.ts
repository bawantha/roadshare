import { Component, inject, OnInit, OnDestroy, effect, signal } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router, NavigationEnd } from '@angular/router';
import { CommonModule } from '@angular/common';
import { SupabaseService } from './services/supabase.service';
import { ToastService } from './services/toast.service';
import { filter } from 'rxjs/operators';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnInit, OnDestroy {
  readonly supabase = inject(SupabaseService);
  readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  bookingCount = signal(0);
  private pollInterval: any;
  private routerSub?: Subscription;

  constructor() {
    // Automatically reload bookings count when auth state changes
    effect(() => {
      if (this.supabase.currentUser()) {
        this.loadBookingsCount();
      } else {
        this.bookingCount.set(0);
      }
    });
  }

  ngOnInit() {
    // Load bookings count initially and poll
    this.pollInterval = setInterval(() => {
      if (this.supabase.currentUser()) {
        this.loadBookingsCount();
      }
    }, 8000);

    // Also reload count when user navigates to booking related paths
    this.routerSub = this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe(() => {
      if (this.supabase.currentUser()) {
        this.loadBookingsCount();
      }
    });
  }

  ngOnDestroy() {
    if (this.pollInterval) clearInterval(this.pollInterval);
    if (this.routerSub) this.routerSub.unsubscribe();
  }

  async loadBookingsCount() {
    try {
      const bookings = await this.supabase.fetchBookings();
      // Only count active requests (status >= 0 and status < 3)
      const activeBookings = bookings.filter(b => b.status >= 0 && b.status < 3);
      this.bookingCount.set(activeBookings.length);
    } catch (err) {
      console.error('Failed to load bookings count', err);
    }
  }

  async logout() {
    try {
      await this.supabase.signOut();
      this.toast.show('Signed out successfully.');
      this.router.navigate(['/']);
    } catch (err: any) {
      this.toast.show(err.message || 'Logout failed');
    }
  }
}
