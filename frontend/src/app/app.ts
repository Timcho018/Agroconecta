import { Component, inject, signal } from '@angular/core';
import { Router, RouterOutlet, NavigationStart, NavigationEnd, NavigationCancel, NavigationError } from '@angular/router';

@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  templateUrl: './app.html',
})
export class App {
  private router = inject(Router);
  navigating = signal(!this.router.navigated);
  private initialized = this.router.navigated;
  constructor() {
    this.router.events.subscribe(event => {
      if (!this.initialized && event instanceof NavigationStart) this.navigating.set(true);
      if (event instanceof NavigationEnd || event instanceof NavigationCancel || event instanceof NavigationError) {
        this.initialized = true;
        this.navigating.set(false);
      }
    });
  }
}
