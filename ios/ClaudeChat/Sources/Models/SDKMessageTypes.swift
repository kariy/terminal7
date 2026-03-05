import Foundation

// Top-level SDK message types
enum SDKMessageType: String {
    case streamEvent = "stream_event"
    case result
    case toolProgress = "tool_progress"
    case toolUseSummary = "tool_use_summary"
    case system
}

// Stream event sub-types
enum StreamEventType: String {
    case contentBlockStart = "content_block_start"
    case contentBlockDelta = "content_block_delta"
    case contentBlockStop = "content_block_stop"
    case messageStart = "message_start"
    case messageDelta = "message_delta"
    case messageStop = "message_stop"
}

// Content delta sub-types
enum ContentDeltaType: String {
    case textDelta = "text_delta"
    case inputJsonDelta = "input_json_delta"
    case thinkingDelta = "thinking_delta"
}
