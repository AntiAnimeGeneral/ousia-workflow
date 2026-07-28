use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use super::error::{FatalError, FatalPhase};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct SourceId(usize);

pub(crate) struct PhysicalSource {
    path: PathBuf,
    parsed: syn::File,
}

#[derive(Default)]
pub(crate) struct PhysicalSourceRepository {
    sources: Vec<PhysicalSource>,
    by_path: BTreeMap<PathBuf, SourceId>,
}

impl PhysicalSourceRepository {
    pub(crate) fn load(&mut self, path: &Path) -> Result<SourceId, FatalError> {
        let canonical = path.canonicalize().map_err(|error| {
            FatalError::new(
                FatalPhase::SourceRead,
                "source-canonicalize-failed",
                error.to_string(),
            )
            .at_path(path)
        })?;
        if let Some(id) = self.by_path.get(&canonical) {
            return Ok(*id);
        }
        let source = std::fs::read_to_string(&canonical).map_err(|error| {
            FatalError::new(
                FatalPhase::SourceRead,
                "source-read-failed",
                error.to_string(),
            )
            .at_path(&canonical)
        })?;
        let parsed = syn::parse_file(&source).map_err(|error| {
            FatalError::new(FatalPhase::Parse, "rust-parse-failed", error.to_string())
                .at_path(&canonical)
                .at_location(error.span().start())
        })?;
        let id = SourceId(self.sources.len());
        self.sources.push(PhysicalSource {
            path: canonical.clone(),
            parsed,
        });
        self.by_path.insert(canonical, id);
        Ok(id)
    }

    pub(crate) fn get(&self, id: SourceId) -> &PhysicalSource {
        &self.sources[id.0]
    }

    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.sources.len()
    }
}

impl PhysicalSource {
    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn file(&self) -> &syn::File {
        &self.parsed
    }
}
