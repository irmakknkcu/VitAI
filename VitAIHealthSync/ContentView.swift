//
//  ContentView.swift
//  VitAIHealthSync
//
//  Use as the root view of your SwiftUI iOS app (VitAIHealthSync).
//

import SwiftUI

struct ContentView: View {
    @StateObject private var healthKitManager = HealthKitManager()
    @StateObject private var syncService = WatchDataSyncService()

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                Text("VitAI Health Sync")
                    .font(.largeTitle.bold())

                Group {
                    LabeledContent("Steps (today)") {
                        Text("\(Int(healthKitManager.steps))")
                            .font(.title2.monospacedDigit())
                    }
                    LabeledContent("Active energy (kcal)") {
                        Text(String(format: "%.1f", healthKitManager.activeCaloriesKcal))
                            .font(.title2.monospacedDigit())
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal)

                VStack(alignment: .leading, spacing: 8) {
                    Text("Status")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(healthKitManager.statusMessage)
                        .font(.subheadline)
                    Text("Backend: \(syncService.lastSyncStatus)")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    URLCopyRow(label: "API", url: syncService.effectiveBackendURL)
                    URLCopyRow(label: "Safari test", url: syncService.serverRootURLForSafariTest)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal)

                VStack(spacing: 12) {
                    Button("Fetch Health Data") {
                        Task {
                            await healthKitManager.refreshTodayMetrics()
                        }
                    }
                    .buttonStyle(.borderedProminent)

                    Button("Sync to Backend") {
                        Task {
                            await syncService.syncToBackend(
                                steps: healthKitManager.steps,
                                calories: healthKitManager.activeCaloriesKcal
                            )
                        }
                    }
                    .buttonStyle(.bordered)
                }
                .padding(.top, 8)

                Spacer()
            }
            .padding(.top, 24)
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

/// Copy-only row — avoids `.textSelection`, which can trigger keyboard accessory layout warnings in the debugger.
private struct URLCopyRow: View {
    let label: String
    let url: String
    @State private var didCopy = false

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text("\(label): \(url)")
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .lineLimit(3)
                .minimumScaleFactor(0.85)
            Spacer(minLength: 4)
            Button(didCopy ? "Copied" : "Copy") {
                UIPasteboard.general.string = url
                didCopy = true
                Task {
                    try? await Task.sleep(for: .seconds(1.5))
                    didCopy = false
                }
            }
            .font(.caption2)
            .buttonStyle(.borderless)
        }
    }
}

#Preview {
    ContentView()
}
