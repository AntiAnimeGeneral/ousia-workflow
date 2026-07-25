use std::collections::{BTreeMap, BTreeSet};

use syn::Item;

use crate::crate_ast::ParsedCrateSet;

use super::model::{FunctionDefinition, FunctionKey, ImportTarget, ModuleKey};
use super::resolution::{CallResolutionContext, ImportResolutionContext, TypePath};

pub(super) struct FunctionInventory {
    pub(super) functions: BTreeMap<FunctionKey, FunctionDefinition>,
    imports: BTreeMap<ModuleKey, BTreeMap<String, ImportTarget>>,
    lib_targets: BTreeMap<(String, String), String>,
}

struct TestModule<'a> {
    attrs: &'a [syn::Attribute],
}

impl FunctionInventory {
    #[doc = "ousia: ownerless-method inventory construction is a static helper"]
    pub(super) fn from_crate_set(parsed: &ParsedCrateSet) -> Self {
        let mut inventory = Self {
            functions: BTreeMap::new(),
            imports: BTreeMap::new(),
            lib_targets: BTreeMap::new(),
        };
        for module in parsed.modules() {
            if let (Some(package_name), Some(lib_crate_name)) =
                (module.package_name(), module.lib_crate_name())
            {
                if module.root_label().contains(":lib:") {
                    inventory.lib_targets.insert(
                        (package_name.to_owned(), lib_crate_name.to_owned()),
                        module.root_label().to_owned(),
                    );
                }
            }
            let Ok(file) = module.parsed_file() else {
                continue;
            };
            inventory.collect_functions(module.root_label(), module.module_path(), &file.items);
        }
        for module in parsed.modules() {
            let Ok(file) = module.parsed_file() else {
                continue;
            };
            inventory.collect_imports(
                module.root_label(),
                module.package_name(),
                module.lib_crate_name(),
                module.module_path(),
                &file.items,
            );
        }
        inventory
    }

    pub(super) fn callers_by_function(
        &self,
        parsed: &ParsedCrateSet,
    ) -> BTreeMap<FunctionKey, BTreeSet<FunctionKey>> {
        let mut callers: BTreeMap<FunctionKey, BTreeSet<FunctionKey>> = BTreeMap::new();
        for module in parsed.modules() {
            let Ok(file) = module.parsed_file() else {
                continue;
            };
            self.collect_calls(
                module.root_label(),
                module.package_name(),
                module.lib_crate_name(),
                module.module_path(),
                &file.items,
                &mut callers,
            );
        }
        callers
    }

    fn collect_functions(&mut self, target: &str, module_path: &[String], items: &[Item]) {
        for item in items {
            match item {
                Item::Fn(function) => {
                    let mut function_path = module_path.to_vec();
                    function_path.push(function.sig.ident.to_string());
                    self.insert_function(target, function_path, &function.sig.ident);
                }
                Item::Mod(module) => {
                    if TestModule::from_attrs(&module.attrs).is_test_module() {
                        continue;
                    }
                    if let Some((_, nested)) = &module.content {
                        let mut nested_module_path = module_path.to_vec();
                        nested_module_path.push(module.ident.to_string());
                        self.collect_functions(target, &nested_module_path, nested);
                    }
                }
                _ => {}
            }
        }
    }

    fn insert_function(&mut self, target: &str, path: Vec<String>, ident: &syn::Ident) {
        self.functions.insert(
            FunctionKey {
                target: target.to_owned(),
                path,
            },
            FunctionDefinition {
                location: format!(
                    "{}:{}:{}",
                    ident,
                    ident.span().start().line,
                    ident.span().start().column + 1,
                ),
            },
        );
    }

    fn collect_imports(
        &mut self,
        target: &str,
        package_name: Option<&str>,
        lib_crate_name: Option<&str>,
        module_path: &[String],
        items: &[Item],
    ) {
        for item in items {
            match item {
                Item::Use(item) => self.collect_use_tree(
                    target,
                    package_name,
                    lib_crate_name,
                    module_path,
                    Vec::new(),
                    &item.tree,
                ),
                Item::Mod(module) => {
                    if TestModule::from_attrs(&module.attrs).is_test_module() {
                        continue;
                    }
                    if let Some((_, nested)) = &module.content {
                        let mut nested_module_path = module_path.to_vec();
                        nested_module_path.push(module.ident.to_string());
                        self.collect_imports(
                            target,
                            package_name,
                            lib_crate_name,
                            &nested_module_path,
                            nested,
                        );
                    }
                }
                _ => {}
            }
        }
    }

    fn collect_use_tree(
        &mut self,
        target: &str,
        package_name: Option<&str>,
        lib_crate_name: Option<&str>,
        module_path: &[String],
        prefix: Vec<String>,
        tree: &syn::UseTree,
    ) {
        match tree {
            syn::UseTree::Path(path) => {
                let mut next_prefix = prefix;
                next_prefix.push(path.ident.to_string());
                self.collect_use_tree(
                    target,
                    package_name,
                    lib_crate_name,
                    module_path,
                    next_prefix,
                    &path.tree,
                );
            }
            syn::UseTree::Name(name) => {
                let mut imported_path = prefix;
                let name = name.ident.to_string();
                let alias = if name == "self" {
                    imported_path.last().cloned().unwrap_or(name)
                } else {
                    imported_path.push(name.clone());
                    name
                };
                self.register_import(
                    target,
                    package_name,
                    lib_crate_name,
                    module_path,
                    alias,
                    imported_path,
                );
            }
            syn::UseTree::Rename(rename) => {
                let mut imported_path = prefix;
                imported_path.push(rename.ident.to_string());
                self.register_import(
                    target,
                    package_name,
                    lib_crate_name,
                    module_path,
                    rename.rename.to_string(),
                    imported_path,
                );
            }
            syn::UseTree::Group(group) => {
                for tree in &group.items {
                    self.collect_use_tree(
                        target,
                        package_name,
                        lib_crate_name,
                        module_path,
                        prefix.clone(),
                        tree,
                    );
                }
            }
            syn::UseTree::Glob(_) => {}
        }
    }

    fn register_import(
        &mut self,
        target: &str,
        package_name: Option<&str>,
        lib_crate_name: Option<&str>,
        module_path: &[String],
        alias: String,
        imported_path: Vec<String>,
    ) {
        let import_context = ImportResolutionContext {
            current_target: target,
            package_name,
            lib_crate_name,
            module_path,
            lib_targets: &self.lib_targets,
        };
        let Some((resolved_target, resolved)) = import_context.resolve_path(&imported_path) else {
            return;
        };
        let function = FunctionKey {
            target: resolved_target,
            path: resolved.clone(),
        };
        let import_target = if self.functions.contains_key(&function) {
            Some(ImportTarget::Function(function))
        } else if self.is_known_module(target, &resolved) {
            Some(ImportTarget::Module(resolved))
        } else {
            None
        };
        if let Some(import_target) = import_target {
            self.imports
                .entry(ModuleKey {
                    target: target.to_owned(),
                    path: module_path.to_vec(),
                })
                .or_default()
                .insert(alias, import_target);
        }
    }

    fn is_known_module(&self, target: &str, module_path: &[String]) -> bool {
        self.functions.keys().any(|function| {
            function.target == target
                && function.path.len() > module_path.len()
                && function.path.starts_with(module_path)
        })
    }

    fn collect_calls(
        &self,
        target: &str,
        package_name: Option<&str>,
        lib_crate_name: Option<&str>,
        module_path: &[String],
        items: &[Item],
        callers: &mut BTreeMap<FunctionKey, BTreeSet<FunctionKey>>,
    ) {
        for item in items {
            match item {
                Item::Fn(function) => {
                    let mut caller = module_path.to_vec();
                    caller.push(function.sig.ident.to_string());
                    self.collect_block_calls(
                        target,
                        package_name,
                        lib_crate_name,
                        module_path,
                        None,
                        caller,
                        &function.block,
                        callers,
                    );
                }
                Item::Impl(item) => {
                    let Some(type_path) = TypePath::from_type(item.self_ty.as_ref()).segments()
                    else {
                        continue;
                    };
                    for inner in &item.items {
                        let syn::ImplItem::Fn(function) = inner else {
                            continue;
                        };
                        let mut caller = module_path.to_vec();
                        caller.extend(type_path.iter().cloned());
                        caller.push(function.sig.ident.to_string());
                        self.collect_block_calls(
                            target,
                            package_name,
                            lib_crate_name,
                            module_path,
                            Some(type_path.clone()),
                            caller,
                            &function.block,
                            callers,
                        );
                    }
                }
                Item::Trait(item) => {
                    let mut trait_path = module_path.to_vec();
                    trait_path.push(item.ident.to_string());
                    for inner in &item.items {
                        let syn::TraitItem::Fn(function) = inner else {
                            continue;
                        };
                        let Some(block) = &function.default else {
                            continue;
                        };
                        let mut caller = trait_path.clone();
                        caller.push(function.sig.ident.to_string());
                        self.collect_block_calls(
                            target,
                            package_name,
                            lib_crate_name,
                            module_path,
                            Some(trait_path.clone()),
                            caller,
                            block,
                            callers,
                        );
                    }
                }
                Item::Mod(module) => {
                    if TestModule::from_attrs(&module.attrs).is_test_module() {
                        continue;
                    }
                    if let Some((_, nested)) = &module.content {
                        let mut nested_module_path = module_path.to_vec();
                        nested_module_path.push(module.ident.to_string());
                        self.collect_calls(
                            target,
                            package_name,
                            lib_crate_name,
                            &nested_module_path,
                            nested,
                            callers,
                        );
                    }
                }
                _ => {}
            }
        }
    }

    fn collect_block_calls(
        &self,
        target: &str,
        package_name: Option<&str>,
        lib_crate_name: Option<&str>,
        module_path: &[String],
        self_type: Option<Vec<String>>,
        caller_path: Vec<String>,
        block: &syn::Block,
        callers: &mut BTreeMap<FunctionKey, BTreeSet<FunctionKey>>,
    ) {
        let caller = FunctionKey {
            target: target.to_owned(),
            path: caller_path,
        };
        let context = CallResolutionContext {
            current_target: target.to_owned(),
            current_package_name: package_name.map(str::to_owned),
            current_lib_crate_name: lib_crate_name.map(str::to_owned),
            current_module: module_path.to_vec(),
            current_self_type: self_type,
            functions: &self.functions,
            imports: &self.imports,
            lib_targets: &self.lib_targets,
        };
        for callee in context.collect_block_callees(block) {
            callers.entry(callee).or_default().insert(caller.clone());
        }
    }
}

impl<'a> TestModule<'a> {
    fn from_attrs(attrs: &'a [syn::Attribute]) -> Self {
        Self { attrs }
    }

    fn is_test_module(&self) -> bool {
        self.attrs.iter().any(|attr| {
            let syn::Meta::List(meta) = &attr.meta else {
                return false;
            };
            meta.path.is_ident("cfg") && meta.tokens.to_string() == "test"
        })
    }
}
