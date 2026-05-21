//
//  AuthService.swift
//  VitAIHealthSync
//
//  Created by Merve Karadöl on 19.05.2026.
//
import Foundation
import Combine

struct LoginRequest: Encodable {
    let email: String
    let password: String
}

struct LoginUser: Decodable {
    let id: Int
    let name: String?
    let surname: String?
    let email: String
    let avatar: String?
}

struct LoginResponse: Decodable {
    let token: String
    let user: LoginUser
}

final class AuthService: ObservableObject {
    @Published var isLoggedIn: Bool
    @Published var currentEmail: String?

    private let loginURL = "http://172.20.10.3:3000/api/auth/login"
    
    init() {
        self.currentEmail = UserDefaults.standard.string(forKey: "loggedInUserEmail")
        self.isLoggedIn = UserDefaults.standard.string(forKey: "loggedInUserEmail") != nil
    }

    func login(email: String, password: String) async throws {
        guard let url = URL(string: loginURL) else {
            throw URLError(.badURL)
        }

        let body = LoginRequest(email: email, password: password)

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let http = response as? HTTPURLResponse,
              (200...299).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }

        let decoded = try JSONDecoder().decode(LoginResponse.self, from: data)

        await MainActor.run {
            UserDefaults.standard.set(decoded.user.email, forKey: "loggedInUserEmail")
            UserDefaults.standard.set(decoded.token, forKey: "authToken")

            self.currentEmail = decoded.user.email
            self.isLoggedIn = true
        }
    }

    func logout() {
        UserDefaults.standard.removeObject(forKey: "loggedInUserEmail")
        UserDefaults.standard.removeObject(forKey: "authToken")

        currentEmail = nil
        isLoggedIn = false
    }
}
