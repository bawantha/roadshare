import { Component, EventEmitter, inject, Input, OnDestroy, OnInit, Output, signal, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SupabaseService, Message } from '../../services/supabase.service';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.css'
})
export class ChatComponent implements OnInit, OnDestroy, AfterViewChecked {
  private readonly supabase = inject(SupabaseService);
  private readonly toast = inject(ToastService);

  @Input() bookingId!: number;
  @Input() bookingItem!: string;
  @Input() recipientName!: string;

  @Output() closed = new EventEmitter<void>();

  @ViewChild('scrollContainer') private scrollContainer!: ElementRef;

  messages = signal<Message[]>([]);
  newMessageContent = '';
  isSending = signal(false);
  isLoading = signal(false);

  private subscription?: { unsubscribe: () => void };
  private shouldScrollToBottom = true;

  ngOnInit() {
    this.loadMessages();
    this.setupSubscription();
  }

  ngOnDestroy() {
    if (this.subscription) {
      this.subscription.unsubscribe();
    }
  }

  ngAfterViewChecked() {
    if (this.shouldScrollToBottom) {
      this.scrollToBottom();
      this.shouldScrollToBottom = false;
    }
  }

  async loadMessages() {
    this.isLoading.set(true);
    try {
      const data = await this.supabase.fetchMessages(this.bookingId);
      this.messages.set(data);
      this.shouldScrollToBottom = true;
    } catch (err: any) {
      console.error(err);
      this.toast.show('Failed to load chat history');
    } finally {
      this.isLoading.set(false);
    }
  }

  setupSubscription() {
    this.subscription = this.supabase.subscribeToMessages(this.bookingId, async () => {
      // Reload messages when insert event happens
      const data = await this.supabase.fetchMessages(this.bookingId);
      this.messages.set(data);
      this.shouldScrollToBottom = true;
    });
  }

  async send() {
    if (!this.newMessageContent.trim()) return;

    const content = this.newMessageContent;
    this.newMessageContent = '';
    this.isSending.set(true);

    try {
      await this.supabase.sendMessage(this.bookingId, content);
      this.shouldScrollToBottom = true;
      // Fetch messages again to update view immediately
      const data = await this.supabase.fetchMessages(this.bookingId);
      this.messages.set(data);
    } catch (err: any) {
      console.error(err);
      this.toast.show('Failed to send message');
      this.newMessageContent = content; // restore text
    } finally {
      this.isSending.set(false);
    }
  }

  isMyMessage(msg: Message): boolean {
    const user = this.supabase.currentUser();
    return user ? msg.sender_id === user.id : false;
  }

  getSenderInitials(msg: Message): string {
    return msg.sender?.name?.charAt(0) || 'U';
  }

  private scrollToBottom(): void {
    try {
      this.scrollContainer.nativeElement.scrollTop = this.scrollContainer.nativeElement.scrollHeight;
    } catch (err) {
      // Container not fully rendered yet
    }
  }

  close() {
    this.closed.emit();
  }
}
