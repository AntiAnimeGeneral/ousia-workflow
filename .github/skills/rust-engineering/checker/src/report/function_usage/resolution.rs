use std::collections::{BTreeMap, BTreeSet};

use syn::visit::{self, Visit};
use syn::{Expr, ExprCall, ExprPath};

use super::model::{FunctionDefinition, FunctionKey, ImportTarget, ModuleKey};

pub(super) struct CallResolutionContext<'a> {
    pub(super) current_target: String,
    pub(super) current_package_name: Option<String>,
    pub(super) current_lib_crate_name: Option<String>,
    pub(super) current_module: Vec<String>,
    pub(super) current_self_type: Option<Vec<String>>,
    pub(super) functions: &'a BTreeMap<FunctionKey, FunctionDefinition>,
    pub(super) imports: &'a BTreeMap<ModuleKey, BTreeMap<String, ImportTarget>>,
    pub(super) lib_targets: &'a BTreeMap<(String, String), String>,
}

pub(super) struct ImportResolutionContext<'a> {
    pub(super) current_target: &'a str,
    pub(super) package_name: Option<&'a str>,
    pub(super) lib_crate_name: Option<&'a str>,
    pub(super) module_path: &'a [String],
    pub(super) lib_targets: &'a BTreeMap<(String, String), String>,
}

pub(super) struct TypePath<'a> {
    ty: &'a syn::Type,
}

struct PathSegments {
    resolved: Vec<String>,
}

struct CallVisitor<'a> {
    context: CallResolutionContext<'a>,
    callees: BTreeSet<FunctionKey>,
}

impl<'a> Visit<'_> for CallVisitor<'a> {
    fn visit_expr_call(&mut self, node: &ExprCall) {
        if let Expr::Path(path) = node.func.as_ref() {
            if let Some(callee) = self.context.resolve_path(&path.path) {
                self.callees.insert(callee);
            }
        }
        visit::visit_expr_call(self, node);
    }

    fn visit_expr_path(&mut self, node: &ExprPath) {
        if let Some(callee) = self.context.resolve_path(&node.path) {
            self.callees.insert(callee);
        }
        visit::visit_expr_path(self, node);
    }
}

impl CallResolutionContext<'_> {
    pub(super) fn collect_block_callees(self, block: &syn::Block) -> BTreeSet<FunctionKey> {
        let mut visitor = CallVisitor {
            context: self,
            callees: BTreeSet::new(),
        };
        visitor.visit_block(block);
        visitor.callees
    }

    fn resolve_path(&self, path: &syn::Path) -> Option<FunctionKey> {
        if path.leading_colon.is_some() {
            return None;
        }
        let segments = path
            .segments
            .iter()
            .map(|segment| segment.ident.to_string())
            .collect::<Vec<_>>();
        if segments.is_empty() {
            return None;
        }
        if segments[0] == "Self" {
            let self_type = self.current_self_type.as_deref()?;
            let mut resolved = self_type.to_vec();
            resolved.extend(segments[1..].iter().cloned());
            let function = FunctionKey {
                target: self.current_target.to_owned(),
                path: resolved,
            };
            return self.functions.contains_key(&function).then_some(function);
        }
        if let (Some(package_name), Some(lib_crate_name)) = (
            self.current_package_name.as_deref(),
            self.current_lib_crate_name.as_deref(),
        ) {
            if segments
                .first()
                .is_some_and(|segment| segment == lib_crate_name)
            {
                let lib_key = (package_name.to_owned(), lib_crate_name.to_owned());
                if let Some(lib_target) = self.lib_targets.get(&lib_key) {
                    let function = FunctionKey {
                        target: lib_target.clone(),
                        path: segments[1..].to_vec(),
                    };
                    if self.functions.contains_key(&function) {
                        return Some(function);
                    }
                }
            }
        }
        let module_key = ModuleKey {
            target: self.current_target.to_owned(),
            path: self.current_module.to_vec(),
        };
        if let Some(import_target) = self
            .imports
            .get(&module_key)
            .and_then(|module_imports| module_imports.get(&segments[0]))
        {
            match import_target {
                ImportTarget::Function(function) if segments.len() == 1 => {
                    return Some(function.clone());
                }
                ImportTarget::Module(module_path) => {
                    let mut resolved = module_path.clone();
                    resolved.extend(segments[1..].iter().cloned());
                    let function = FunctionKey {
                        target: self.current_target.to_owned(),
                        path: resolved,
                    };
                    if self.functions.contains_key(&function) {
                        return Some(function);
                    }
                }
                _ => {}
            }
        }
        if segments.len() == 1 {
            if let Some(resolved) = self
                .imports
                .get(&module_key)
                .and_then(|module_imports| module_imports.get(&segments[0]))
            {
                if let ImportTarget::Function(function) = resolved {
                    return Some(function.clone());
                }
            }
        }
        let resolved = self.resolve_segments(&segments)?;
        let function = FunctionKey {
            target: self.current_target.to_owned(),
            path: resolved,
        };
        self.functions.contains_key(&function).then_some(function)
    }

    fn resolve_segments(&self, segments: &[String]) -> Option<Vec<String>> {
        PathSegments {
            resolved: self.current_module.to_vec(),
        }
        .resolve(segments)
    }
}

impl ImportResolutionContext<'_> {
    pub(super) fn resolve_path(&self, imported_path: &[String]) -> Option<(String, Vec<String>)> {
        if let (Some(package_name), Some(lib_crate_name)) = (self.package_name, self.lib_crate_name)
        {
            if imported_path
                .first()
                .is_some_and(|segment| segment == lib_crate_name)
            {
                let lib_key = (package_name.to_owned(), lib_crate_name.to_owned());
                if self.lib_targets.contains_key(&lib_key) {
                    let mut resolved = Vec::new();
                    resolved.extend(imported_path[1..].iter().cloned());
                    return Some((self.lib_targets.get(&lib_key)?.clone(), resolved));
                }
            }
        }
        self.resolve_segments(imported_path)
            .map(|resolved| (self.current_target.to_owned(), resolved))
    }

    fn resolve_segments(&self, segments: &[String]) -> Option<Vec<String>> {
        PathSegments {
            resolved: self.module_path.to_vec(),
        }
        .resolve(segments)
    }
}

impl<'a> TypePath<'a> {
    pub(super) fn from_type(ty: &'a syn::Type) -> Self {
        Self { ty }
    }

    pub(super) fn segments(&self) -> Option<Vec<String>> {
        let syn::Type::Path(path) = self.ty else {
            return None;
        };
        if path.qself.is_some() {
            return None;
        }
        Some(
            path.path
                .segments
                .iter()
                .map(|segment| segment.ident.to_string())
                .collect(),
        )
    }
}

impl PathSegments {
    fn resolve(mut self, segments: &[String]) -> Option<Vec<String>> {
        let mut index = 0;
        while index < segments.len() {
            match segments[index].as_str() {
                "crate" => {
                    self.resolved.clear();
                    index += 1;
                }
                "self" => {
                    index += 1;
                }
                "super" => {
                    self.resolved.pop()?;
                    index += 1;
                }
                _ => break,
            }
        }
        self.resolved.extend(segments[index..].iter().cloned());
        Some(self.resolved)
    }
}
