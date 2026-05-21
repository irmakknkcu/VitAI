//
//  LoginView.swift
//  VitAIHealthSync
//
//  Created by Merve Karadöl on 19.05.2026.
//

import SwiftUI

struct LoginView: View {
    @ObservedObject var authService: AuthService

    @State private var email = ""
    @State private var password = ""
    @State private var errorMessage = ""

    var body: some View {
        VStack(spacing: 16) {
            Text("VitAI Login")
                .font(.largeTitle.bold())

            TextField("Email", text: $email)
                .textFieldStyle(.roundedBorder)
                .textInputAutocapitalization(.never)
                .keyboardType(.emailAddress)

            SecureField("Password", text: $password)
                .textFieldStyle(.roundedBorder)

            Button("Login") {
                Task {
                    do {
                        try await authService.login(email: email, password: password)
                    } catch {
                        errorMessage = "Login failed. Email or password may be wrong."
                    }
                }
            }
            .buttonStyle(.borderedProminent)

            if !errorMessage.isEmpty {
                Text(errorMessage)
                    .foregroundStyle(.red)
                    .font(.caption)
            }
        }
        .padding()
    }
}
