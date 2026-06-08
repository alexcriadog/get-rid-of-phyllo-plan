// Barrel for the Phyllo-compatible mapping layer (§ PLAN-phyllo-schema-alignment.md).
export * from "./phyllo-types";
export * from "./context";
export * from "./ids";
export * from "./serializers";
export * from "./buckets";
export * from "./format";
export * from "./work-platforms";
export * from "./envelope";
export { buildEnvelope } from "./mappers/envelope.mapper";
export { toPhylloProfile } from "./mappers/profile.mapper";
export { toPhylloAudience } from "./mappers/audience.mapper";
export { toPhylloContent, type DeepJoin } from "./mappers/content.mapper";
export {
  toPhylloComment,
  type CommentContentJoin,
} from "./mappers/comment.mapper";
