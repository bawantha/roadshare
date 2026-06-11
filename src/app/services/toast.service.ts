import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class ToastService {
  private readonly messageSignal = signal<string | null>(null);
  readonly message = this.messageSignal.asReadonly();
  private timeoutId: any;

  show(msg: string) {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }
    this.messageSignal.set(msg);
    this.timeoutId = setTimeout(() => {
      this.messageSignal.set(null);
    }, 3200);
  }
}
