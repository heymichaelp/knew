// KnewFoundationModels.swift — the native half of `@popjoker/knew/apple`.
//
// knew's JavaScript (`appleModel`) sends each call here through the app's own native bridge —
// an Expo module or a React Native native module, as ADOPTING.md shows — and gets back the
// answer as JSON. Everything stays on the device.
//
// A REFERENCE, NOT A BUILD ARTIFACT: this file ships in the package for the app to add to its
// own native target. It is written against Apple's Foundation Models framework (iOS 26,
// macOS 26) and has been checked on a device build only by the apps that use it; the package's
// own tests exercise the JavaScript half with a stand-in for this file.

import Foundation
import FoundationModels

/// A failure the JavaScript half acts on, by `code`:
/// `context` (too long for the model), `unavailable` (not on this device, Apple Intelligence off,
/// or the model not downloaded yet), `unsupported-language`, `guardrail`, `bad-schema` or `failed`.
public struct KnewModelError: Error, LocalizedError {
  public let code: String
  public let message: String
  public var errorDescription: String? { message }
}

/// The schema `appleModel` sends: `AppleSchema` in `@popjoker/knew/apple`, as JSON.
final class KnewSchemaNode: Decodable {
  let kind: String
  let name: String?
  let properties: [KnewSchemaProperty]?
  let items: KnewSchemaNode?
  let choices: [String]?
}

final class KnewSchemaProperty: Decodable {
  let name: String
  let schema: KnewSchemaNode
  let optional: Bool
}

@available(iOS 26.0, macOS 26.0, *)
public enum KnewFoundationModels {
  /// Whether the on-device model can answer now: `available`, or why not.
  public static func availability() -> String {
    switch SystemLanguageModel.default.availability {
    case .available:
      return "available"
    case .unavailable(let reason):
      switch reason {
      case .deviceNotEligible: return "device-not-eligible"
      case .appleIntelligenceNotEnabled: return "apple-intelligence-off"
      case .modelNotReady: return "model-not-ready"
      @unknown default: return "unavailable"
      }
    }
  }

  /// One call: the instructions, the prompt and the schema in; the answer, as JSON, out.
  public static func respond(instructions: String, prompt: String, schemaJSON: String) async throws -> String {
    guard case .available = SystemLanguageModel.default.availability else {
      throw KnewModelError(code: "unavailable", message: "the on-device model is not available: \(availability())")
    }
    let node: KnewSchemaNode
    do {
      node = try JSONDecoder().decode(KnewSchemaNode.self, from: Data(schemaJSON.utf8))
    } catch {
      throw KnewModelError(code: "bad-schema", message: "the schema did not decode: \(error.localizedDescription)")
    }
    let schema = try GenerationSchema(root: try dynamicSchema(node), dependencies: [])
    let session = LanguageModelSession(instructions: instructions)
    do {
      let response = try await session.respond(to: prompt, schema: schema, options: GenerationOptions(temperature: 0))
      return response.content.jsonString
    } catch let error as LanguageModelSession.GenerationError {
      switch error {
      case .exceededContextWindowSize:
        throw KnewModelError(code: "context", message: "the request is longer than the on-device model can take in")
      case .guardrailViolation:
        throw KnewModelError(code: "guardrail", message: "the on-device model's guardrails declined the request")
      case .unsupportedLanguageOrLocale:
        throw KnewModelError(code: "unsupported-language", message: "the on-device model does not read this language")
      case .assetsUnavailable:
        throw KnewModelError(code: "unavailable", message: "the on-device model is not downloaded yet")
      default:
        throw KnewModelError(code: "failed", message: error.localizedDescription)
      }
    }
  }

  /// `AppleSchema` as a `DynamicGenerationSchema`: objects by name, arrays of anything, strings
  /// (free or one of a set of choices), integers, numbers and booleans. Optional fields are how
  /// knew's nulls arrive; the JavaScript half turns a missing one back into null.
  static func dynamicSchema(_ node: KnewSchemaNode) throws -> DynamicGenerationSchema {
    switch node.kind {
    case "object":
      return DynamicGenerationSchema(
        name: node.name ?? "Object",
        properties: try (node.properties ?? []).map { property in
          DynamicGenerationSchema.Property(name: property.name, schema: try dynamicSchema(property.schema), isOptional: property.optional)
        }
      )
    case "array":
      guard let items = node.items else { throw KnewModelError(code: "bad-schema", message: "an array with no items") }
      return DynamicGenerationSchema(arrayOf: try dynamicSchema(items))
    case "string":
      if let choices = node.choices, !choices.isEmpty {
        return DynamicGenerationSchema(name: node.name ?? "Choice", anyOf: choices)
      }
      return DynamicGenerationSchema(type: String.self)
    case "integer":
      return DynamicGenerationSchema(type: Int.self)
    case "number":
      return DynamicGenerationSchema(type: Double.self)
    case "boolean":
      return DynamicGenerationSchema(type: Bool.self)
    default:
      throw KnewModelError(code: "bad-schema", message: "no kind \(node.kind)")
    }
  }
}
