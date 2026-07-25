#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(super) struct FunctionKey {
    pub(super) target: String,
    pub(super) path: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(super) struct ModuleKey {
    pub(super) target: String,
    pub(super) path: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum ImportTarget {
    Function(FunctionKey),
    Module(Vec<String>),
}

pub(super) struct FunctionDefinition {
    pub(super) location: String,
}

pub(super) struct ReportRow {
    pub(super) used_by_functions: usize,
    pub(super) target: String,
    pub(super) function: String,
    pub(super) callers: String,
    pub(super) location: String,
}
