//
//  WatchDataSyncService.swift
//  VitAIHealthSync
//
//  Created by Merve Karadöl on 26.04.2026.
//
//  Mac LAN IP + :3000 (Node). Prefer this file over the minimal snippet: it sends log_date,
//  normalizes missing :3000 on private IPs, uses timeouts, and maps URLError (local LAN, ATS).
//  Info.plist: NSLocalNetworkUsageDescription + ATS (see VitAIHealthSync-Info-additions.plist).
//

import Combine
import Foundation

enum WatchDataSyncError: LocalizedError {
    case invalidURL
    case invalidResponse
    case serverError(statusCode: Int, message: String?)
    case requestTimedOut
    case appTransportSecurityBlocked
    /// Often URLError -1009 with “Local network prohibited” when NSLocalNetworkUsageDescription is missing or toggle off.
    case localNetworkBlockedByIOS
    /// TCP failed (refused, no route, wrong IP, firewall, AP isolation, phone on cellular).
    case linkFailed(url: String, urlErrorCode: Int, systemMessage: String)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid sync URL."
        case .invalidResponse:
            return "Invalid response from server."
        case .serverError(let code, let message):
            if let message, !message.isEmpty {
                return "Server error (\(code)): \(message)"
            }
            return "Server error: HTTP \(code)"
        case .requestTimedOut:
            return "Request timed out. Check backend IP, port, and Wi-Fi network."
        case .appTransportSecurityBlocked:
            return "iOS blocked HTTP (cleartext). In Xcode: Info → App Transport Security → Exception Domain for your Mac IP, or use HTTPS."
        case .localNetworkBlockedByIOS:
            return """
            iOS yerel ağı kapattı (log: “Local network prohibited” / -1009).
            Xcode: Target → Info → “Privacy - Local Network Usage Description” ekleyin (VitAIHealthSync-Info-additions.plist dosyasına bakın).
            iPhone: Ayarlar → Gizlilik ve Güvenlik → Yerel Ağ → uygulamanız açık olsun.
            """
        case .linkFailed(let url, let code, let systemMessage):
            return """
            Bağlantı kurulamadı (\(code)): \(systemMessage)
            Hedef: \(url)
            Kontrol: Mac’te `node server.js` çalışıyor mu? IP, Mac’in Wi‑Fi IP’si mi (Ayarlar → Ağ)? iPhone da aynı Wi‑Fi’da mı (mobil veri kapalı)? macOS Güvenlik Duvarı 3000 portuna izin veriyor mu? Misafir/kurumsal Wi‑Fi cihazları birbirine kapatabilir.
            """
        }
    }
}

struct WatchDataPayload: Encodable {
    let email: String
    let steps: Double
    let calories: Double
    let source: String
    /// Calendar day for these totals (device local timezone), `yyyy-MM-dd`.
    let log_date: String
}

final class WatchDataSyncService: ObservableObject {
    /// Override: UserDefaults `VitAIBackendBaseURL` or Info.plist `VitAIBackendBaseURL`. Use same host as `node server.js` prints ("iPhone test URL").
    private var baseURLString: String {
        let raw: String
        if let u = UserDefaults.standard.string(forKey: "VitAIBackendBaseURL"), !u.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            raw = u.trimmingCharacters(in: .whitespacesAndNewlines)
        } else if let u = Bundle.main.object(forInfoDictionaryKey: "VitAIBackendBaseURL") as? String, !u.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            raw = u.trimmingCharacters(in: .whitespacesAndNewlines)
        } else {
            raw = "http://172.20.10.3:3000/api/watch-data"
        }
        return Self.normalizedBackendURLString(raw)
    }

    /// If `http://192.168.x.x/...` has no port, HTTP would use 80; Node uses 3000 — insert :3000 for private / loopback hosts.
    private static func normalizedBackendURLString(_ raw: String) -> String {
        let s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard var c = URLComponents(string: s), let host = c.host else {
            return insertHTTPPort3000ForPrivateIPv4IfNeeded(s)
        }
        let scheme = (c.scheme ?? "http").lowercased()
        guard scheme == "http" else { return s }
        if c.port != nil { return s }
        guard isPrivateOrLoopbackLANHost(host) else { return s }
        c.port = 3000
        if let absolute = c.url?.absoluteString { return absolute }
        if let rebuilt = c.string { return rebuilt }
        return insertHTTPPort3000ForPrivateIPv4IfNeeded(s)
    }

    /// Fallback when URLComponents does not rebuild (avoids silent fallback to port 80).
    private static func insertHTTPPort3000ForPrivateIPv4IfNeeded(_ s: String) -> String {
        guard s.hasPrefix("http://"), !s.hasPrefix("http://[") else { return s }
        let noScheme = String(s.dropFirst("http://".count))
        guard let slashIdx = noScheme.firstIndex(of: "/") else { return s }
        let hostCandidate = String(noScheme[..<slashIdx])
        if hostCandidate.contains(":") { return s }
        guard isPrivateOrLoopbackLANHost(hostCandidate) else { return s }
        let pathAndQuery = String(noScheme[slashIdx...])
        return "http://\(hostCandidate):3000\(pathAndQuery)"
    }

    private static func isPrivateOrLoopbackLANHost(_ host: String) -> Bool {
        if host == "localhost" { return true }
        let parts = host.split(separator: ".").compactMap { Int($0) }
        guard parts.count == 4 else { return false }
        let a = parts[0], b = parts[1]
        if a == 10 { return true }
        if a == 172, (16 ... 31).contains(b) { return true }
        if a == 192, b == 168 { return true }
        if a == 127 { return true }
        return false
    }

    /// Must exist in DB `users.email`. Override: UserDefaults `VitAISyncEmail` or Info.plist `VitAISyncEmail`.
    private var syncEmail: String {
        if let e = UserDefaults.standard.string(forKey: "VitAISyncEmail"), !e.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return e.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        if let e = Bundle.main.object(forInfoDictionaryKey: "VitAISyncEmail") as? String, !e.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return e.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return "merve112@gmail.com"
    }

    var effectiveBackendURL: String { baseURLString }

    /// Open this in iPhone Safari; if the VitAI page does not load, the app cannot sync either.
    var serverRootURLForSafariTest: String {
        guard let u = URL(string: baseURLString), let scheme = u.scheme, let host = u.host else {
            return baseURLString
        }
        let port = u.port.map { ":\($0)" } ?? ""
        return "\(scheme)://\(host)\(port)/"
    }

    @Published var lastSyncStatus: String = "Not synced yet"

    private static let localIsoDateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = .current
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    func syncToBackend(steps: Double, calories: Double) async {
        await MainActor.run {
            self.lastSyncStatus = "Syncing…"
        }

        do {
            try await performSync(steps: steps, calories: calories)
            await MainActor.run {
                self.lastSyncStatus = "Synced successfully"
            }
        } catch {
            await MainActor.run {
                self.lastSyncStatus = error.localizedDescription
            }
        }
    }

    private func performSync(steps: Double, calories: Double) async throws {
        guard let url = URL(string: baseURLString) else {
            throw WatchDataSyncError.invalidURL
        }

        let payload = WatchDataPayload(
            email: syncEmail,
            steps: steps,
            calories: calories,
            source: "apple_health",
            log_date: Self.localIsoDateFormatter.string(from: Date())
        )

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(payload)
        do {
            let config = URLSessionConfiguration.default
            config.timeoutIntervalForRequest = 15
            config.timeoutIntervalForResource = 20
            config.waitsForConnectivity = false
            let session = URLSession(configuration: config)

            let (data, response) = try await session.data(for: request)

            guard let http = response as? HTTPURLResponse else {
                throw WatchDataSyncError.invalidResponse
            }

            guard (200 ... 299).contains(http.statusCode) else {
                let body = String(data: data, encoding: .utf8)
                let message = Self.parseServerErrorMessage(from: data) ?? body
                throw WatchDataSyncError.serverError(statusCode: http.statusCode, message: message)
            }
        } catch let urlError as URLError {
            switch urlError.code {
            case .timedOut:
                throw WatchDataSyncError.requestTimedOut
            case .appTransportSecurityRequiresSecureConnection:
                throw WatchDataSyncError.appTransportSecurityBlocked
            case .notConnectedToInternet:
                if Self.urlErrorIndicatesLocalNetworkDenied(urlError) {
                    throw WatchDataSyncError.localNetworkBlockedByIOS
                }
                throw WatchDataSyncError.linkFailed(
                    url: baseURLString,
                    urlErrorCode: urlError.code.rawValue,
                    systemMessage: urlError.localizedDescription
                )
            default:
                throw WatchDataSyncError.linkFailed(
                    url: baseURLString,
                    urlErrorCode: urlError.code.rawValue,
                    systemMessage: urlError.localizedDescription
                )
            }
        }
    }

    private static func parseServerErrorMessage(from data: Data) -> String? {
        struct ErrBody: Decodable { let error: String? }
        return (try? JSONDecoder().decode(ErrBody.self, from: data))?.error
    }

    private static func urlErrorIndicatesLocalNetworkDenied(_ error: URLError) -> Bool {
        var errors: [NSError] = [(error as NSError)]
        var cur: NSError? = error as NSError
        while let u = cur?.userInfo[NSUnderlyingErrorKey] as? NSError {
            errors.append(u)
            cur = u
        }
        for e in errors {
            if e.localizedDescription.localizedCaseInsensitiveContains("local network prohibited") {
                return true
            }
            for (_, value) in e.userInfo {
                let s = String(describing: value)
                if s.localizedCaseInsensitiveContains("local network prohibited") { return true }
            }
        }
        return false
    }
}
