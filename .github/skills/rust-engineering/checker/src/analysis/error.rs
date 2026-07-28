use std::fmt;
use std::path::{Path, PathBuf};

use proc_macro2::LineColumn;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum FatalPhase {
    Subject,
    CargoMetadata,
    CfgEnvironment,
    SourceRead,
    Parse,
    Graph,
    Model,
    Render,
    OutputCommit,
}

#[derive(Debug)]
pub struct FatalError {
    phase: FatalPhase,
    code: &'static str,
    path: Option<PathBuf>,
    location: Option<LineColumn>,
    message: String,
}

impl FatalError {
    pub(crate) fn new(phase: FatalPhase, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            phase,
            code,
            path: None,
            location: None,
            message: message.into(),
        }
    }

    pub(crate) fn at_path(mut self, path: impl AsRef<Path>) -> Self {
        self.path = Some(path.as_ref().to_path_buf());
        self
    }

    pub(crate) fn at_location(mut self, location: LineColumn) -> Self {
        self.location = Some(location);
        self
    }

    #[cfg(test)]
    pub(crate) fn code(&self) -> &'static str {
        self.code
    }

    pub(crate) fn subject(error: impl fmt::Display) -> Self {
        Self::new(FatalPhase::Subject, "subject-invalid", error.to_string())
    }

    pub(crate) fn render(error: impl fmt::Display) -> Self {
        Self::new(FatalPhase::Render, "render-failed", error.to_string())
    }

    pub fn output_commit(error: impl fmt::Display) -> Self {
        Self::new(
            FatalPhase::OutputCommit,
            "output-commit-failed",
            error.to_string(),
        )
    }
}

impl fmt::Display for FatalError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let phase = match self.phase {
            FatalPhase::Subject => "subject",
            FatalPhase::CargoMetadata => "cargo-metadata",
            FatalPhase::CfgEnvironment => "cfg-environment",
            FatalPhase::SourceRead => "source-read",
            FatalPhase::Parse => "parse",
            FatalPhase::Graph => "graph",
            FatalPhase::Model => "model",
            FatalPhase::Render => "render",
            FatalPhase::OutputCommit => "output-commit",
        };
        if let Some(path) = &self.path {
            write!(formatter, "{phase}/{}: {}", self.code, path.display())?;
            if let Some(location) = self.location {
                write!(formatter, ":{}:{}", location.line, location.column + 1)?;
            }
            write!(formatter, ": {}", self.message)
        } else {
            write!(formatter, "{phase}/{}: {}", self.code, self.message)
        }
    }
}

impl std::error::Error for FatalError {}
