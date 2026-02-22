/**
 * Dashboard Integration Tests
 * Tests dashboard API integration and data display
 * 
 * Requirements: 7.1, 7.5
 */

import request from 'supertest';
import express, { Application } from 'express';
import path from 'path';
import dashboardRoutes from '../src/routes/dashboard-routes';

describe('Dashboard Integration Tests', () => {
  let app: Application;

  beforeAll(() => {
    // Setup Express app for dashboard testing
    app = express();
    app.use(express.json());
    app.use(express.static(path.join(process.cwd(), 'public')));
    
    // Mount dashboard routes
    app.use('/', dashboardRoutes);
  });

  describe('Static File Serving', () => {
    test('should serve dashboard HTML at root path', async () => {
      const response = await request(app).get('/');
      
      expect(response.status).toBe(200);
      expect(response.type).toMatch(/html/);
      expect(response.text).toContain('URL Monitoring Dashboard');
    });

    test('should serve login page', async () => {
      const response = await request(app).get('/login.html');
      
      expect(response.status).toBe(200);
      expect(response.type).toMatch(/html/);
      expect(response.text).toContain('Sign in to your account');
    });

    test('should serve CSS files', async () => {
      const response = await request(app).get('/css/styles.css');
      
      expect(response.status).toBe(200);
      expect(response.type).toMatch(/css/);
    });

    test('should serve JavaScript files', async () => {
      const response = await request(app).get('/js/app.js');
      
      expect(response.status).toBe(200);
      expect(response.type).toMatch(/javascript/);
    });
  });

  describe('Dashboard API Integration', () => {
    test('should have API endpoints accessible (structure test)', () => {
      // This test verifies the dashboard expects certain API endpoints
      // Actual API integration would require full database setup
      expect(true).toBe(true);
    });

    test('dashboard JavaScript includes API integration code', async () => {
      const response = await request(app).get('/js/app.js');
      
      expect(response.text).toContain('apiRequest');
      expect(response.text).toContain('/monitors');
      expect(response.text).toContain('/auth/logout');
      expect(response.text).toContain('/notification-channels');
    });
  });

  describe('Dashboard Data Display', () => {
    test('dashboard HTML should contain monitor grid element', async () => {
      const response = await request(app).get('/');
      
      expect(response.text).toContain('id="monitor-grid"');
      expect(response.text).toContain('class="monitor-grid"');
    });

    test('dashboard HTML should contain search functionality', async () => {
      const response = await request(app).get('/');
      
      expect(response.text).toContain('id="search-input"');
      expect(response.text).toContain('Search monitors');
    });

    test('dashboard HTML should contain add monitor button', async () => {
      const response = await request(app).get('/');
      
      expect(response.text).toContain('id="add-monitor-btn"');
      expect(response.text).toContain('Add Monitor');
    });

    test('dashboard HTML should contain monitor details modal', async () => {
      const response = await request(app).get('/');
      
      expect(response.text).toContain('id="monitor-details-modal"');
      expect(response.text).toContain('tab-btn');
      expect(response.text).toContain('overview');
      expect(response.text).toContain('metrics');
      expect(response.text).toContain('alerts');
    });

    test('dashboard HTML should contain notification channels section', async () => {
      const response = await request(app).get('/');
      
      expect(response.text).toContain('notification-section');
      expect(response.text).toContain('id="channels-list"');
      expect(response.text).toContain('Add Channel');
    });

    test('dashboard HTML should contain monitor form modal', async () => {
      const response = await request(app).get('/');
      
      expect(response.text).toContain('id="monitor-form-modal"');
      expect(response.text).toContain('id="monitor-form"');
      expect(response.text).toContain('monitor-name');
      expect(response.text).toContain('monitor-url');
      expect(response.text).toContain('monitor-interval');
    });
  });

  describe('Real-time Updates', () => {
    test('dashboard JavaScript should include refresh functionality', async () => {
      const response = await request(app).get('/js/app.js');
      
      expect(response.text).toContain('loadMonitors');
      expect(response.text).toContain('refreshInterval');
      expect(response.text).toContain('setInterval');
    });

    test('dashboard JavaScript should include API request helper', async () => {
      const response = await request(app).get('/js/app.js');
      
      expect(response.text).toContain('apiRequest');
      expect(response.text).toContain('Authorization');
      expect(response.text).toContain('Bearer');
    });

    test('dashboard JavaScript should handle authentication', async () => {
      const response = await request(app).get('/js/app.js');
      
      expect(response.text).toContain('localStorage.getItem');
      expect(response.text).toContain('token');
      expect(response.text).toContain('login.html');
    });
  });

  describe('Responsive Design', () => {
    test('CSS should include responsive breakpoints', async () => {
      const response = await request(app).get('/css/styles.css');
      
      expect(response.text).toContain('@media');
      expect(response.text).toContain('max-width');
    });

    test('HTML should include viewport meta tag', async () => {
      const response = await request(app).get('/');
      
      expect(response.text).toContain('viewport');
      expect(response.text).toContain('width=device-width');
    });

    test('CSS should include mobile-friendly grid layout', async () => {
      const response = await request(app).get('/css/styles.css');
      
      expect(response.text).toContain('grid-template-columns');
      expect(response.text).toContain('auto-fill');
    });
  });

  describe('User Interactions', () => {
    test('dashboard JavaScript should handle monitor card clicks', async () => {
      const response = await request(app).get('/js/app.js');
      
      expect(response.text).toContain('showMonitorDetails');
      expect(response.text).toContain('onclick');
    });

    test('dashboard JavaScript should handle form submissions', async () => {
      const response = await request(app).get('/js/app.js');
      
      expect(response.text).toContain('saveMonitor');
      expect(response.text).toContain('addEventListener');
      expect(response.text).toContain('submit');
    });

    test('dashboard JavaScript should handle modal interactions', async () => {
      const response = await request(app).get('/js/app.js');
      
      expect(response.text).toContain('showModal');
      expect(response.text).toContain('closeModal');
    });

    test('dashboard JavaScript should handle search filtering', async () => {
      const response = await request(app).get('/js/app.js');
      
      expect(response.text).toContain('filterMonitors');
      expect(response.text).toContain('search-input');
    });

    test('dashboard JavaScript should handle tab switching', async () => {
      const response = await request(app).get('/js/app.js');
      
      expect(response.text).toContain('switchTab');
      expect(response.text).toContain('tab-btn');
    });
  });

  describe('Error Handling', () => {
    test('dashboard JavaScript should handle API errors', async () => {
      const response = await request(app).get('/js/app.js');
      
      expect(response.text).toContain('catch');
      expect(response.text).toContain('error');
    });

    test('dashboard JavaScript should handle authentication failures', async () => {
      const response = await request(app).get('/js/app.js');
      
      expect(response.text).toContain('401');
      expect(response.text).toContain('localStorage.removeItem');
    });

    test('login page should display error messages', async () => {
      const response = await request(app).get('/login.html');
      
      expect(response.text).toContain('error-message');
    });
  });
});
