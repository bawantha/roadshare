import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ToastService } from '../../services/toast.service';
import {
  CITIES,
  CODE,
  getDistance,
  calculatePrice,
  getFerryNote,
  SIZE_LABEL,
  SIZE_SHORT_LABEL,
  offsetDate
} from '../../utils/geo.utils';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css'
})
export class HomeComponent {
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  readonly cities = CITIES;
  readonly sizeOptions = Object.entries(SIZE_LABEL).map(([value, label]) => ({ value, label }));

  qFrom = 'Melbourne';
  qTo = 'Sydney';
  qSize = 'M';
  qWhen = offsetDate(5);

  showResult = signal(false);
  estimatedPrice = signal<number | null>(null);
  quoteMeta = signal('');

  popularRoutes = [
    { from: 'Melbourne', to: 'Sydney' },
    { from: 'Sydney', to: 'Brisbane' },
    { from: 'Melbourne', to: 'Adelaide' },
    { from: 'Adelaide', to: 'Perth' }
  ];

  getRouteCode(city: string): string {
    return CODE[city] || city.substring(0, 3).toUpperCase();
  }

  getRouteDistance(from: string, to: string): string {
    return getDistance(from, to).toLocaleString();
  }

  getRouteStartingPrice(from: string, to: string): number {
    return calculatePrice(from, to, 'S');
  }

  getQuote() {
    if (this.qFrom === this.qTo) {
      this.toast.show('Pick two different cities');
      return;
    }

    const price = calculatePrice(this.qFrom, this.qTo, this.qSize);
    const distance = getDistance(this.qFrom, this.qTo);
    const sizeShort = SIZE_SHORT_LABEL[this.qSize];
    const ferry = getFerryNote(this.qFrom, this.qTo);

    this.estimatedPrice.set(price);
    this.quoteMeta.set(
      `${this.qFrom} → ${this.qTo} · ${distance.toLocaleString()} km · ${sizeShort} item${ferry} · vs ~$${Math.round(price * 2.4)} with a courier`
    );
    this.showResult.set(true);
  }

  seeMatchingTrips() {
    this.router.navigate(['/trips'], {
      queryParams: { from: this.qFrom, to: this.qTo }
    });
  }

  onPopularRouteClick(from: string, to: string) {
    this.qFrom = from;
    this.qTo = to;
    this.getQuote();
    // Scroll quote card into view
    const card = document.getElementById('quoteCard');
    if (card) {
      card.scrollIntoView({ behavior: 'smooth' });
    }
  }
}
