use std::path::{Path, PathBuf};

use crate::diagnostic::Diagnostic;

pub(crate) struct RuleContext {
    path: PathBuf,
    diagnostics: Vec<Diagnostic>,
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
        location: proc_macro2::LineColumn,
        message: impl Into<String>,
    ) {
        self.diagnostics
            .push(Diagnostic::new(code, &self.path, location, message));
    }

    pub(crate) fn into_diagnostics(self) -> Vec<Diagnostic> {
        self.diagnostics
    }
}
