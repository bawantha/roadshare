import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { SupabaseService } from '../../services/supabase.service';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-auth',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './auth.component.html',
  styleUrl: './auth.component.css'
})
export class AuthComponent {
  private readonly supabase = inject(SupabaseService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  isSignUp = signal(false);
  isLoading = signal(false);

  email = '';
  password = '';
  name = '';

  toggleMode() {
    this.isSignUp.update(v => !v);
    this.email = '';
    this.password = '';
    this.name = '';
  }

  async onSubmit() {
    if (!this.email || !this.password || (this.isSignUp() && !this.name)) {
      this.toast.show('Please fill in all fields');
      return;
    }

    this.isLoading.set(true);
    try {
      if (this.isSignUp()) {
        await this.supabase.signUp(this.email, this.password, this.name);
        this.toast.show('Account created successfully! Welcome to RoadShare.');
      } else {
        await this.supabase.signIn(this.email, this.password);
        this.toast.show('Logged in successfully!');
      }
      this.router.navigate(['/']);
    } catch (err: any) {
      console.error(err);
      this.toast.show(err.message || 'An error occurred during authentication');
    } finally {
      this.isLoading.set(false);
    }
  }
}
