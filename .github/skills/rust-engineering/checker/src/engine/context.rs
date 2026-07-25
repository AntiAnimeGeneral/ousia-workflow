use std::path::{Path, PathBuf};

use proc_macro2::LineColumn;

use crate::diagnostic::Diagnostic;

pub(crate) struct RuleContext {
    path: PathBuf,
    diagnostics: Vec<Diagnostic>,
}

pub(crate) struct ModuleOwner {
    pub(crate) name: String,
    pub(crate) location: LineColumn,
}

impl RuleContext {
    pub(crate) fn new(path: impl AsRef<Path>) -> Self {
        Self {
            path: path.as_ref().to_path_buf(),
            diagnostics: Vec::new(),
        }
    }

    pub(crate) fn emit(
        &mut self,
        code: &'static str,
        location: LineColumn,
        message: impl Into<String>,
    ) {
        self.diagnostics
            .push(Diagnostic::new(code, &self.path, location, message));
    }

    pub(crate) fn into_diagnostics(self) -> Vec<Diagnostic> {
        self.diagnostics
    }
}
