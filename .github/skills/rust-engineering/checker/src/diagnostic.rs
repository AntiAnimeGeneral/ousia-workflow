use std::fmt;
use std::path::{Path, PathBuf};

use proc_macro2::LineColumn;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    pub code: &'static str,
    pub path: PathBuf,
    pub line: usize,
    pub column: usize,
    pub message: String,
}

impl Diagnostic {
    pub(crate) fn new(
        code: &'static str,
        path: &Path,
        location: LineColumn,
        message: impl Into<String>,
    ) -> Self {
        Self {
            code,
            path: path.to_path_buf(),
            line: location.line,
            column: location.column + 1,
            message: message.into(),
        }
    }
}

impl fmt::Display for Diagnostic {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{}:{}:{}: {}: {}",
            self.path.display(),
            self.line,
            self.column,
            self.code,
            self.message,
        )
    }
}
