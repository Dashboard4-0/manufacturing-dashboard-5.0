import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sentry_flutter/sentry_flutter.dart';
import 'app.dart';
import 'services/notification_service.dart';
import 'services/offline_service.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Initialize services
  await _initializeServices();

  // Initialize Sentry for error tracking
  await SentryFlutter.init(
    (options) {
      options.dsn = const String.fromEnvironment('SENTRY_DSN');
      options.environment = const String.fromEnvironment('ENV', defaultValue: 'development');
      options.tracesSampleRate = 1.0;
    },
    appRunner: () => runApp(
      const ProviderScope(
        child: MS5AndonApp(),
      ),
    ),
  );
}

Future<void> _initializeServices() async {
  // Initialize shared preferences
  await SharedPreferences.getInstance();

  // Initialize notification service
  final notificationService = NotificationService();
  await notificationService.initialize();

  // Initialize offline service
  final offlineService = OfflineService();
  await offlineService.initialize();

  // Request permissions
  await notificationService.requestPermissions();
}