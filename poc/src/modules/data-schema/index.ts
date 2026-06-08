// Barrel for the InsightIQ-compatible mapping layer (§ PLAN-canonical-data-api.md).
export * from "./api-types";
export * from "./context";
export * from "./ids";
export * from "./serializers";
export * from "./buckets";
export * from "./format";
export * from "./work-platforms";
export * from "./envelope";
export { buildEnvelope } from "./mappers/envelope.mapper";
export { toApiProfile } from "./mappers/profile.mapper";
export { toApiAudience } from "./mappers/audience.mapper";
export { toApiContent, type DeepJoin } from "./mappers/content.mapper";
export {
  toApiComment,
  type CommentContentJoin,
} from "./mappers/comment.mapper";
