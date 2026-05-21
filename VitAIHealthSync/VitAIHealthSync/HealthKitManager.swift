//
//  HealthKitManager.swift
//  VitAIHealthSync
//
//  Add to your iOS app target. Enable HealthKit capability.
//  Info.plist: NSHealthShareUsageDescription (required for read access).
//

import Combine
import Foundation
import HealthKit

enum HealthKitManagerError: LocalizedError {
    case healthDataNotAvailable
    case quantityTypeUnavailable(HKQuantityTypeIdentifier)
    case authorizationDenied

    var errorDescription: String? {
        switch self {
        case .healthDataNotAvailable:
            return "Health data is not available on this device."
        case .quantityTypeUnavailable(let id):
            return "HealthKit quantity type unavailable: \(id.rawValue)."
        case .authorizationDenied:
            return "HealthKit authorization was not granted."
        }
    }
}

final class HealthKitManager: ObservableObject {
    private let healthStore = HKHealthStore()

    @Published private(set) var steps: Double = 0
    @Published private(set) var activeCaloriesKcal: Double = 0
    @Published var statusMessage: String = "Ready"

    /// Types this app reads from HealthKit.
    private var readTypes: Set<HKObjectType> {
        var set = Set<HKObjectType>()
        if let steps = HKQuantityType.quantityType(for: .stepCount) {
            set.insert(steps)
        }
        if let energy = HKQuantityType.quantityType(for: .activeEnergyBurned) {
            set.insert(energy)
        }
        return set
    }

    func requestReadAuthorization() async throws {
        guard HKHealthStore.isHealthDataAvailable() else {
            throw HealthKitManagerError.healthDataNotAvailable
        }

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            healthStore.requestAuthorization(toShare: nil, read: readTypes) { success, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                if !success {
                    continuation.resume(throwing: HealthKitManagerError.authorizationDenied)
                    return
                }
                continuation.resume(returning: ())
            }
        }
    }

    /// Fetches today's cumulative step count (start of day → now).
    func fetchTodayStepCount() async throws -> Double {
        guard HKHealthStore.isHealthDataAvailable() else {
            throw HealthKitManagerError.healthDataNotAvailable
        }
        guard let stepType = HKQuantityType.quantityType(for: .stepCount) else {
            throw HealthKitManagerError.quantityTypeUnavailable(.stepCount)
        }

        let now = Date()
        let startOfDay = Calendar.current.startOfDay(for: now)
        let predicate = HKQuery.predicateForSamples(withStart: startOfDay, end: now, options: .strictStartDate)

        return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Double, Error>) in
            let query = HKStatisticsQuery(
                quantityType: stepType,
                quantitySamplePredicate: predicate,
                options: .cumulativeSum
            ) { _, statistics, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                guard let sum = statistics?.sumQuantity() else {
                    continuation.resume(returning: 0)
                    return
                }
                let value = sum.doubleValue(for: HKUnit.count())
                continuation.resume(returning: value)
            }
            self.healthStore.execute(query)
        }
    }

    /// Fetches today's cumulative active energy burned in kilocalories.
    func fetchTodayActiveEnergyBurnedKcal() async throws -> Double {
        guard HKHealthStore.isHealthDataAvailable() else {
            throw HealthKitManagerError.healthDataNotAvailable
        }
        guard let energyType = HKQuantityType.quantityType(for: .activeEnergyBurned) else {
            throw HealthKitManagerError.quantityTypeUnavailable(.activeEnergyBurned)
        }

        let now = Date()
        let startOfDay = Calendar.current.startOfDay(for: now)
        let predicate = HKQuery.predicateForSamples(withStart: startOfDay, end: now, options: .strictStartDate)

        return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Double, Error>) in
            let query = HKStatisticsQuery(
                quantityType: energyType,
                quantitySamplePredicate: predicate,
                options: .cumulativeSum
            ) { _, statistics, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                guard let sum = statistics?.sumQuantity() else {
                    continuation.resume(returning: 0)
                    return
                }
                let value = sum.doubleValue(for: HKUnit.kilocalorie())
                continuation.resume(returning: value)
            }
            self.healthStore.execute(query)
        }
    }

    /// Requests authorization (if needed) and loads today's steps and active calories into published properties.
    func refreshTodayMetrics() async {
        do {
            statusMessage = "Requesting HealthKit access…"
            try await requestReadAuthorization()

            statusMessage = "Reading HealthKit data…"
            let stepValue = try await fetchTodayStepCount()
            let kcalValue = try await fetchTodayActiveEnergyBurnedKcal()

            await MainActor.run {
                self.steps = stepValue
                self.activeCaloriesKcal = kcalValue
                self.statusMessage = "Updated \(Date().formatted(date: .omitted, time: .shortened))"
            }
        } catch {
            await MainActor.run {
                self.statusMessage = error.localizedDescription
            }
        }
    }
}
