import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/andon_provider.dart';
import '../widgets/andon_button.dart';
import '../models/andon_call.dart';

class AndonScreen extends ConsumerStatefulWidget {
  const AndonScreen({super.key});

  @override
  ConsumerState<AndonScreen> createState() => _AndonScreenState();
}

class _AndonScreenState extends ConsumerState<AndonScreen> {
  String? selectedStation;
  String? selectedLine;

  @override
  Widget build(BuildContext context) {
    final andonState = ref.watch(andonProvider);
    final andonNotifier = ref.read(andonProvider.notifier);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Andon System'),
        actions: [
          IconButton(
            icon: const Icon(Icons.history),
            onPressed: () {
              // Navigate to history
            },
          ),
          IconButton(
            icon: const Icon(Icons.notifications),
            onPressed: () {
              // Show notifications
            },
          ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Station Selection
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Station Information',
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    const SizedBox(height: 16),
                    DropdownButtonFormField<String>(
                      value: selectedLine,
                      decoration: const InputDecoration(
                        labelText: 'Production Line',
                        prefixIcon: Icon(Icons.precision_manufacturing),
                      ),
                      items: ['Line 1', 'Line 2', 'Line 3']
                          .map((line) => DropdownMenuItem(
                                value: line,
                                child: Text(line),
                              ))
                          .toList(),
                      onChanged: (value) {
                        setState(() {
                          selectedLine = value;
                        });
                      },
                    ),
                    const SizedBox(height: 12),
                    DropdownButtonFormField<String>(
                      value: selectedStation,
                      decoration: const InputDecoration(
                        labelText: 'Station',
                        prefixIcon: Icon(Icons.workspaces),
                      ),
                      items: ['Station 1', 'Station 2', 'Station 3', 'Station 4']
                          .map((station) => DropdownMenuItem(
                                value: station,
                                child: Text(station),
                              ))
                          .toList(),
                      onChanged: (value) {
                        setState(() {
                          selectedStation = value;
                        });
                      },
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 24),

            // Andon Trigger Buttons
            Expanded(
              child: GridView.count(
                crossAxisCount: 2,
                mainAxisSpacing: 16,
                crossAxisSpacing: 16,
                children: [
                  AndonButton(
                    type: AndonType.quality,
                    color: Colors.red,
                    icon: Icons.warning,
                    label: 'Quality Issue',
                    onPressed: selectedStation != null && selectedLine != null
                        ? () => _triggerAndon(AndonType.quality)
                        : null,
                  ),
                  AndonButton(
                    type: AndonType.maintenance,
                    color: Colors.orange,
                    icon: Icons.build,
                    label: 'Maintenance',
                    onPressed: selectedStation != null && selectedLine != null
                        ? () => _triggerAndon(AndonType.maintenance)
                        : null,
                  ),
                  AndonButton(
                    type: AndonType.material,
                    color: Colors.yellow.shade700,
                    icon: Icons.inventory,
                    label: 'Material',
                    onPressed: selectedStation != null && selectedLine != null
                        ? () => _triggerAndon(AndonType.material)
                        : null,
                  ),
                  AndonButton(
                    type: AndonType.changeover,
                    color: Colors.blue,
                    icon: Icons.swap_horiz,
                    label: 'Changeover',
                    onPressed: selectedStation != null && selectedLine != null
                        ? () => _triggerAndon(AndonType.changeover)
                        : null,
                  ),
                  AndonButton(
                    type: AndonType.safety,
                    color: Colors.purple,
                    icon: Icons.health_and_safety,
                    label: 'Safety',
                    onPressed: selectedStation != null && selectedLine != null
                        ? () => _triggerAndon(AndonType.safety)
                        : null,
                  ),
                  AndonButton(
                    type: AndonType.other,
                    color: Colors.grey,
                    icon: Icons.help,
                    label: 'Other',
                    onPressed: selectedStation != null && selectedLine != null
                        ? () => _triggerAndon(AndonType.other)
                        : null,
                  ),
                ],
              ),
            ),

            // Active Call Status
            if (andonState.activeCall != null)
              Card(
                color: Theme.of(context).colorScheme.errorContainer,
                child: Padding(
                  padding: const EdgeInsets.all(16.0),
                  child: Column(
                    children: [
                      Text(
                        'Active Andon Call',
                        style: Theme.of(context).textTheme.titleMedium?.copyWith(
                              color: Theme.of(context).colorScheme.onErrorContainer,
                            ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        andonState.activeCall!.type.toString().split('.').last.toUpperCase(),
                        style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                              color: Theme.of(context).colorScheme.onErrorContainer,
                              fontWeight: FontWeight.bold,
                            ),
                      ),
                      const SizedBox(height: 8),
                      StreamBuilder<int>(
                        stream: Stream.periodic(const Duration(seconds: 1), (i) => i),
                        builder: (context, snapshot) {
                          final duration = DateTime.now()
                              .difference(andonState.activeCall!.triggeredAt);
                          return Text(
                            '${duration.inMinutes}:${(duration.inSeconds % 60).toString().padLeft(2, '0')}',
                            style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                                  color: Theme.of(context).colorScheme.onErrorContainer,
                                ),
                          );
                        },
                      ),
                      const SizedBox(height: 16),
                      ElevatedButton.icon(
                        onPressed: () => _cancelAndon(),
                        icon: const Icon(Icons.cancel),
                        label: const Text('Cancel Call'),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: Theme.of(context).colorScheme.error,
                          foregroundColor: Theme.of(context).colorScheme.onError,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _triggerAndon(AndonType type) async {
    final andonNotifier = ref.read(andonProvider.notifier);

    // Show confirmation dialog
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Trigger Andon?'),
        content: Text(
          'Are you sure you want to trigger ${type.toString().split('.').last} andon for $selectedStation on $selectedLine?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Confirm'),
          ),
        ],
      ),
    );

    if (confirmed == true) {
      await andonNotifier.triggerAndon(
        type: type,
        lineId: selectedLine!,
        stationId: selectedStation!,
      );

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Andon triggered successfully'),
            backgroundColor: Colors.green,
          ),
        );
      }
    }
  }

  Future<void> _cancelAndon() async {
    final andonNotifier = ref.read(andonProvider.notifier);
    final activeCall = ref.read(andonProvider).activeCall;

    if (activeCall != null) {
      await andonNotifier.cancelAndon(activeCall.id);

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Andon call cancelled'),
          ),
        );
      }
    }
  }
}