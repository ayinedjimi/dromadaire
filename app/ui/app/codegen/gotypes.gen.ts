/* Do not change, this code is generated from Golang structs */


export class ChatInfo {
    id: string;
    title: string;
    userExcerpt: string;
    createdAt: Date;
    updatedAt: Date;
    pinned: boolean;
    folder: string;
    messageCount: number;
    tokenEstimate: number;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.id = source["id"];
        this.title = source["title"];
        this.userExcerpt = source["userExcerpt"];
        this.createdAt = new Date(source["createdAt"]);
        this.updatedAt = new Date(source["updatedAt"]);
        this.pinned = source["pinned"] || false;
        this.folder = source["folder"] || "";
        this.messageCount = source["messageCount"] || 0;
        this.tokenEstimate = source["tokenEstimate"] || 0;
    }
}
export class ChatsResponse {
    chatInfos: ChatInfo[];

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.chatInfos = this.convertValues(source["chatInfos"], ChatInfo);
    }

	convertValues(a: any, classs: any, asMap: boolean = false): any {
	    if (!a) {
	        return a;
	    }
	    if (Array.isArray(a)) {
	        return (a as any[]).map(elem => this.convertValues(elem, classs));
	    } else if ("object" === typeof a) {
	        if (asMap) {
	            for (const key of Object.keys(a)) {
	                a[key] = new classs(a[key]);
	            }
	            return a;
	        }
	        return new classs(a);
	    }
	    return a;
	}
}
export class Time {


    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);

    }
}
export class ToolFunction {
    name: string;
    arguments: string;
    result?: any;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.name = source["name"];
        this.arguments = source["arguments"];
        this.result = source["result"];
    }
}
export class ToolCall {
    type: string;
    function: ToolFunction;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.type = source["type"];
        this.function = this.convertValues(source["function"], ToolFunction);
    }

	convertValues(a: any, classs: any, asMap: boolean = false): any {
	    if (!a) {
	        return a;
	    }
	    if (Array.isArray(a)) {
	        return (a as any[]).map(elem => this.convertValues(elem, classs));
	    } else if ("object" === typeof a) {
	        if (asMap) {
	            for (const key of Object.keys(a)) {
	                a[key] = new classs(a[key]);
	            }
	            return a;
	        }
	        return new classs(a);
	    }
	    return a;
	}
}
export class File {
    filename: string;
    data: number[];

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.filename = source["filename"];
        this.data = source["data"];
    }
}
export class Message {
    role: string;
    content: string;
    thinking: string;
    stream: boolean;
    model?: string;
    attachments?: File[];
    tool_calls?: ToolCall[];
    tool_call?: ToolCall;
    tool_name?: string;
    tool_result?: number[];
    created_at: Time;
    updated_at: Time;
    thinkingTimeStart?: Date | undefined;
    thinkingTimeEnd?: Date | undefined;
    genInfo?: { evalCount: number; evalDurationMs: number; promptEvalCount?: number; promptEvalDurationMs?: number; tokensPerSecond: number };

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.role = source["role"];
        this.content = source["content"];
        this.thinking = source["thinking"];
        this.stream = source["stream"];
        this.model = source["model"];
        this.attachments = this.convertValues(source["attachments"], File);
        this.tool_calls = this.convertValues(source["tool_calls"], ToolCall);
        this.tool_call = this.convertValues(source["tool_call"], ToolCall);
        this.tool_name = source["tool_name"];
        this.tool_result = source["tool_result"];
        this.created_at = this.convertValues(source["created_at"], Time);
        this.updated_at = this.convertValues(source["updated_at"], Time);
        this.thinkingTimeStart = source["thinkingTimeStart"] && new Date(source["thinkingTimeStart"]);
        this.thinkingTimeEnd = source["thinkingTimeEnd"] && new Date(source["thinkingTimeEnd"]);
        this.genInfo = source["genInfo"];
    }

	convertValues(a: any, classs: any, asMap: boolean = false): any {
	    if (!a) {
	        return a;
	    }
	    if (Array.isArray(a)) {
	        return (a as any[]).map(elem => this.convertValues(elem, classs));
	    } else if ("object" === typeof a) {
	        if (asMap) {
	            for (const key of Object.keys(a)) {
	                a[key] = new classs(a[key]);
	            }
	            return a;
	        }
	        return new classs(a);
	    }
	    return a;
	}
}
export class Chat {
    id: string;
    messages: Message[];
    title: string;
    created_at: Time;
    browser_state?: BrowserStateData;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.id = source["id"];
        this.messages = this.convertValues(source["messages"], Message);
        this.title = source["title"];
        this.created_at = this.convertValues(source["created_at"], Time);
        this.browser_state = source["browser_state"];
    }

	convertValues(a: any, classs: any, asMap: boolean = false): any {
	    if (!a) {
	        return a;
	    }
	    if (Array.isArray(a)) {
	        return (a as any[]).map(elem => this.convertValues(elem, classs));
	    } else if ("object" === typeof a) {
	        if (asMap) {
	            for (const key of Object.keys(a)) {
	                a[key] = new classs(a[key]);
	            }
	            return a;
	        }
	        return new classs(a);
	    }
	    return a;
	}
}
export class ChatResponse {
    chat: Chat;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.chat = this.convertValues(source["chat"], Chat);
    }

	convertValues(a: any, classs: any, asMap: boolean = false): any {
	    if (!a) {
	        return a;
	    }
	    if (Array.isArray(a)) {
	        return (a as any[]).map(elem => this.convertValues(elem, classs));
	    } else if ("object" === typeof a) {
	        if (asMap) {
	            for (const key of Object.keys(a)) {
	                a[key] = new classs(a[key]);
	            }
	            return a;
	        }
	        return new classs(a);
	    }
	    return a;
	}
}
export class Model {
    model: string;
    digest?: string;
    modified_at?: Time;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.model = source["model"];
        this.digest = source["digest"];
        this.modified_at = this.convertValues(source["modified_at"], Time);
    }

	convertValues(a: any, classs: any, asMap: boolean = false): any {
	    if (!a) {
	        return a;
	    }
	    if (Array.isArray(a)) {
	        return (a as any[]).map(elem => this.convertValues(elem, classs));
	    } else if ("object" === typeof a) {
	        if (asMap) {
	            for (const key of Object.keys(a)) {
	                a[key] = new classs(a[key]);
	            }
	            return a;
	        }
	        return new classs(a);
	    }
	    return a;
	}
}
export class ModelsResponse {
    models: Model[];

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.models = this.convertValues(source["models"], Model);
    }

	convertValues(a: any, classs: any, asMap: boolean = false): any {
	    if (!a) {
	        return a;
	    }
	    if (Array.isArray(a)) {
	        return (a as any[]).map(elem => this.convertValues(elem, classs));
	    } else if ("object" === typeof a) {
	        if (asMap) {
	            for (const key of Object.keys(a)) {
	                a[key] = new classs(a[key]);
	            }
	            return a;
	        }
	        return new classs(a);
	    }
	    return a;
	}
}
export class InferenceCompute {
    library: string;
    variant: string;
    compute: string;
    driver: string;
    name: string;
    vram: string;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.library = source["library"];
        this.variant = source["variant"];
        this.compute = source["compute"];
        this.driver = source["driver"];
        this.name = source["name"];
        this.vram = source["vram"];
    }
}
export class InferenceComputeResponse {
    inferenceComputes: InferenceCompute[];

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.inferenceComputes = this.convertValues(source["inferenceComputes"], InferenceCompute);
    }

	convertValues(a: any, classs: any, asMap: boolean = false): any {
	    if (!a) {
	        return a;
	    }
	    if (Array.isArray(a)) {
	        return (a as any[]).map(elem => this.convertValues(elem, classs));
	    } else if ("object" === typeof a) {
	        if (asMap) {
	            for (const key of Object.keys(a)) {
	                a[key] = new classs(a[key]);
	            }
	            return a;
	        }
	        return new classs(a);
	    }
	    return a;
	}
}
export class ModelCapabilitiesResponse {
    capabilities: string[];

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.capabilities = source["capabilities"];
    }
}
export class RAGSource {
    index: number;
    document_id: string;
    document_name: string;
    chunk_index: number;
    excerpt: string;
    score: number;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.index = source["index"];
        this.document_id = source["document_id"];
        this.document_name = source["document_name"];
        this.chunk_index = source["chunk_index"];
        this.excerpt = source["excerpt"];
        this.score = source["score"];
    }
}
export class ChatEvent {
    eventName: "chat" | "thinking" | "assistant_with_tools" | "tool_call" | "tool" | "tool_result" | "tool_approval" | "done" | "chat_created" | "rag_sources";
    content?: string;
    thinking?: string;
    thinkingTimeStart?: Date | undefined;
    thinkingTimeEnd?: Date | undefined;
    toolCalls?: ToolCall[];
    toolCall?: ToolCall;
    toolName?: string;
    toolResult?: boolean;
    toolResultData?: any;
    chatId?: string;
    toolState?: any;
    ragSources?: RAGSource[];
    evalCount?: number;
    evalDurationMs?: number;
    promptEvalCount?: number;
    promptEvalDurationMs?: number;
    tokensPerSecond?: number;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.eventName = source["eventName"];
        this.content = source["content"];
        this.thinking = source["thinking"];
        this.thinkingTimeStart = source["thinkingTimeStart"] && new Date(source["thinkingTimeStart"]);
        this.thinkingTimeEnd = source["thinkingTimeEnd"] && new Date(source["thinkingTimeEnd"]);
        this.toolCalls = this.convertValues(source["toolCalls"], ToolCall);
        this.toolCall = this.convertValues(source["toolCall"], ToolCall);
        this.toolName = source["toolName"];
        this.toolResult = source["toolResult"];
        this.toolResultData = source["toolResultData"];
        this.chatId = source["chatId"];
        this.toolState = source["toolState"];
        this.ragSources = this.convertValues(source["ragSources"], RAGSource);
        this.evalCount = source["evalCount"];
        this.evalDurationMs = source["evalDurationMs"];
        this.promptEvalCount = source["promptEvalCount"];
        this.promptEvalDurationMs = source["promptEvalDurationMs"];
        this.tokensPerSecond = source["tokensPerSecond"];
    }

	convertValues(a: any, classs: any, asMap: boolean = false): any {
	    if (!a) {
	        return a;
	    }
	    if (Array.isArray(a)) {
	        return (a as any[]).map(elem => this.convertValues(elem, classs));
	    } else if ("object" === typeof a) {
	        if (asMap) {
	            for (const key of Object.keys(a)) {
	                a[key] = new classs(a[key]);
	            }
	            return a;
	        }
	        return new classs(a);
	    }
	    return a;
	}
}
export class DownloadEvent {
    eventName: "download";
    total: number;
    completed: number;
    done: boolean;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.eventName = source["eventName"];
        this.total = source["total"];
        this.completed = source["completed"];
        this.done = source["done"];
    }
}
export class ErrorEvent {
    eventName: "error";
    error: string;
    code?: string;
    details?: string;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.eventName = source["eventName"];
        this.error = source["error"];
        this.code = source["code"];
        this.details = source["details"];
    }
}
export class Settings {
    Expose: boolean;
    Browser: boolean;
    Survey: boolean;
    Models: string;
    Agent: boolean;
    Tools: boolean;
    WorkingDir: string;
    ContextLength: number;
    AirplaneMode: boolean;
    TurboEnabled: boolean;
    WebSearchEnabled: boolean;
    ThinkEnabled: boolean;
    ThinkLevel: string;
    SelectedModel: string;
    SidebarOpen: boolean;
    EncryptionEnabled: boolean;
    RAGEnabled: boolean;
    EmbeddingModel: string;
    PasswordEnabled: boolean;
    AutoDeleteOnFailure: boolean;
    LockTimeoutMinutes: number;
    AutoDeleteDays: number;
    ClipboardClearSeconds: number;
    SearchEnabled: boolean;
    RAGCitationsEnabled: boolean;
    RAGPreviewEnabled: boolean;
    ArtifactsEnabled: boolean;
    Theme: string;
    KeyboardShortcutsEnabled: boolean;
    NumThread: number;
    KeepAlive: string;
    MaxLoadedModels: number;
    KVCacheType: string;
    NumBatch: number;
    UseMlock: boolean;
    RopeFrequencyBase: number;
    RopeFrequencyScale: number;
    VulkanEnabled: boolean;
    NumParallel: number;
    ResponseMode: string;
    SystemPrompt: string;
    HumanSubMode: string;
    WritingStyleRules: string;
    StyleAnalysisModel: string;
    RAGAffinityThreshold: number;
    RAGRetrievalLimit: number;
    ChatFullWidth: boolean;
    AutoTitleEnabled: boolean;
    ShowTokenCount: boolean;
    ContextOverflowPolicy: string;
    SidebarWidth: number;
    ContextPanelWidth: number;
    PortableMode?: boolean;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.Expose = source["Expose"];
        this.Browser = source["Browser"];
        this.Survey = source["Survey"];
        this.Models = source["Models"];
        this.Agent = source["Agent"];
        this.Tools = source["Tools"];
        this.WorkingDir = source["WorkingDir"];
        this.ContextLength = source["ContextLength"];
        this.AirplaneMode = source["AirplaneMode"];
        this.TurboEnabled = source["TurboEnabled"];
        this.WebSearchEnabled = source["WebSearchEnabled"];
        this.ThinkEnabled = source["ThinkEnabled"];
        this.ThinkLevel = source["ThinkLevel"];
        this.SelectedModel = source["SelectedModel"];
        this.SidebarOpen = source["SidebarOpen"];
        this.EncryptionEnabled = source["EncryptionEnabled"];
        this.RAGEnabled = source["RAGEnabled"];
        this.EmbeddingModel = source["EmbeddingModel"];
        this.PasswordEnabled = source["PasswordEnabled"];
        this.AutoDeleteOnFailure = source["AutoDeleteOnFailure"];
        this.LockTimeoutMinutes = source["LockTimeoutMinutes"];
        this.AutoDeleteDays = source["AutoDeleteDays"];
        this.ClipboardClearSeconds = source["ClipboardClearSeconds"];
        this.SearchEnabled = source["SearchEnabled"];
        this.RAGCitationsEnabled = source["RAGCitationsEnabled"];
        this.RAGPreviewEnabled = source["RAGPreviewEnabled"];
        this.ArtifactsEnabled = source["ArtifactsEnabled"];
        this.Theme = source["Theme"];
        this.KeyboardShortcutsEnabled = source["KeyboardShortcutsEnabled"];
        this.NumThread = source["NumThread"];
        this.KeepAlive = source["KeepAlive"];
        this.MaxLoadedModels = source["MaxLoadedModels"];
        this.KVCacheType = source["KVCacheType"];
        this.NumBatch = source["NumBatch"];
        this.UseMlock = source["UseMlock"];
        this.RopeFrequencyBase = source["RopeFrequencyBase"];
        this.RopeFrequencyScale = source["RopeFrequencyScale"];
        this.VulkanEnabled = source["VulkanEnabled"];
        this.NumParallel = source["NumParallel"];
        this.ResponseMode = source["ResponseMode"];
        this.SystemPrompt = source["SystemPrompt"];
        this.HumanSubMode = source["HumanSubMode"];
        this.WritingStyleRules = source["WritingStyleRules"];
        this.StyleAnalysisModel = source["StyleAnalysisModel"];
        this.RAGAffinityThreshold = source["RAGAffinityThreshold"];
        this.RAGRetrievalLimit = source["RAGRetrievalLimit"];
        this.ChatFullWidth = source["ChatFullWidth"];
        this.AutoTitleEnabled = source["AutoTitleEnabled"];
        this.ShowTokenCount = source["ShowTokenCount"];
        this.ContextOverflowPolicy = source["ContextOverflowPolicy"];
        this.SidebarWidth = source["SidebarWidth"];
        this.ContextPanelWidth = source["ContextPanelWidth"];
        this.PortableMode = source["PortableMode"];
    }
}
export class SettingsResponse {
    settings: Settings;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.settings = this.convertValues(source["settings"], Settings);
    }

	convertValues(a: any, classs: any, asMap: boolean = false): any {
	    if (!a) {
	        return a;
	    }
	    if (Array.isArray(a)) {
	        return (a as any[]).map(elem => this.convertValues(elem, classs));
	    } else if ("object" === typeof a) {
	        if (asMap) {
	            for (const key of Object.keys(a)) {
	                a[key] = new classs(a[key]);
	            }
	            return a;
	        }
	        return new classs(a);
	    }
	    return a;
	}
}
export class HealthResponse {
    healthy: boolean;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.healthy = source["healthy"];
    }
}
export class User {
    id: string;
    email: string;
    name: string;
    bio?: string;
    avatarurl?: string;
    firstname?: string;
    lastname?: string;
    plan?: string;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.id = source["id"];
        this.email = source["email"];
        this.name = source["name"];
        this.bio = source["bio"];
        this.avatarurl = source["avatarurl"];
        this.firstname = source["firstname"];
        this.lastname = source["lastname"];
        this.plan = source["plan"];
    }
}
export class Attachment {
    filename: string;
    data?: string;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.filename = source["filename"];
        this.data = source["data"];
    }
}
export class ChatRequest {
    model: string;
    prompt: string;
    index?: number;
    attachments?: Attachment[];
    web_search?: boolean;
    file_tools?: boolean;
    forceUpdate?: boolean;
    think?: any;
    temperature?: number;
    top_p?: number;
    num_predict?: number;
    top_k?: number;
    min_p?: number;
    typical_p?: number;
    repeat_penalty?: number;
    repeat_last_n?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    seed?: number;
    flash_attn?: boolean;
    cache_type_k?: string;
    cache_type_v?: string;
    stop?: string[];
    num_gpu?: number;
    num_ctx?: number;
    num_thread?: number;
    num_batch?: number;
    format?: any;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.model = source["model"];
        this.prompt = source["prompt"];
        this.index = source["index"];
        this.attachments = this.convertValues(source["attachments"], Attachment);
        this.web_search = source["web_search"];
        this.file_tools = source["file_tools"];
        this.forceUpdate = source["forceUpdate"];
        this.think = source["think"];
        this.format = source["format"];
        this.temperature = source["temperature"];
        this.top_p = source["top_p"];
        this.num_predict = source["num_predict"];
        this.top_k = source["top_k"];
        this.min_p = source["min_p"];
        this.typical_p = source["typical_p"];
        this.repeat_penalty = source["repeat_penalty"];
        this.repeat_last_n = source["repeat_last_n"];
        this.frequency_penalty = source["frequency_penalty"];
        this.presence_penalty = source["presence_penalty"];
        this.seed = source["seed"];
        this.flash_attn = source["flash_attn"];
        this.cache_type_k = source["cache_type_k"];
        this.cache_type_v = source["cache_type_v"];
        this.stop = source["stop"];
        this.num_gpu = source["num_gpu"];
        this.num_ctx = source["num_ctx"];
        this.num_thread = source["num_thread"];
        this.num_batch = source["num_batch"];
    }

	convertValues(a: any, classs: any, asMap: boolean = false): any {
	    if (!a) {
	        return a;
	    }
	    if (Array.isArray(a)) {
	        return (a as any[]).map(elem => this.convertValues(elem, classs));
	    } else if ("object" === typeof a) {
	        if (asMap) {
	            for (const key of Object.keys(a)) {
	                a[key] = new classs(a[key]);
	            }
	            return a;
	        }
	        return new classs(a);
	    }
	    return a;
	}
}
export class Error {
    error: string;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.error = source["error"];
    }
}
export class SystemMetrics {
    memory_used_mb: number;
    memory_total_mb: number;
    memory_percent: number;
    goroutines: number;
    uptime_seconds: number;
    heap_alloc_mb: number;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.memory_used_mb = source["memory_used_mb"];
        this.memory_total_mb = source["memory_total_mb"];
        this.memory_percent = source["memory_percent"];
        this.goroutines = source["goroutines"];
        this.uptime_seconds = source["uptime_seconds"];
        this.heap_alloc_mb = source["heap_alloc_mb"];
    }
}
export class ModelUpstreamResponse {
    digest?: string;
    pushTime: number;
    error?: string;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.digest = source["digest"];
        this.pushTime = source["pushTime"];
        this.error = source["error"];
    }
}
export class Page {
    url: string;
    title: string;
    text: string;
    lines: string[];
    links?: Record<number, string>;
    fetched_at: Time;

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.url = source["url"];
        this.title = source["title"];
        this.text = source["text"];
        this.lines = source["lines"];
        this.links = source["links"];
        this.fetched_at = this.convertValues(source["fetched_at"], Time);
    }

	convertValues(a: any, classs: any, asMap: boolean = false): any {
	    if (!a) {
	        return a;
	    }
	    if (Array.isArray(a)) {
	        return (a as any[]).map(elem => this.convertValues(elem, classs));
	    } else if ("object" === typeof a) {
	        if (asMap) {
	            for (const key of Object.keys(a)) {
	                a[key] = new classs(a[key]);
	            }
	            return a;
	        }
	        return new classs(a);
	    }
	    return a;
	}
}
export class BrowserStateData {
    page_stack: string[];
    view_tokens: number;
    url_to_page: {[key: string]: Page};

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.page_stack = source["page_stack"];
        this.view_tokens = source["view_tokens"];
        this.url_to_page = source["url_to_page"];
    }
}
