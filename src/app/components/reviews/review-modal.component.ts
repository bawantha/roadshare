import { Component, EventEmitter, inject, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../../services/supabase.service';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-review-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './review-modal.component.html',
  styleUrl: './review-modal.component.css'
})
export class ReviewModalComponent {
  private readonly supabase = inject(SupabaseService);
  private readonly toast = inject(ToastService);

  @Input() bookingId!: number;
  @Input() driverId!: string;
  @Input() driverName!: string;

  @Output() closed = new EventEmitter<void>();
  @Output() submitted = new EventEmitter<void>();

  rating = signal(5);
  comment = '';
  isSubmitting = signal(false);

  stars = [1, 2, 3, 4, 5];

  setRating(val: number) {
    this.rating.set(val);
  }

  async submit() {
    this.isSubmitting.set(true);
    try {
      await this.supabase.submitReview(
        this.bookingId,
        this.driverId,
        this.rating(),
        this.comment
      );
      this.toast.show(`Thanks! Review submitted for ${this.driverName}.`);
      this.submitted.emit();
    } catch (err: any) {
      console.error(err);
      this.toast.show(err.message || 'Failed to submit review');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  cancel() {
    this.closed.emit();
  }
}
