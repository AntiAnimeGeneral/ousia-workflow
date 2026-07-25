#![doc = "ousia: module-owner rust-checker-use-alias-rule"]

use crate::engine::context::RuleContext;

pub(crate) fn check_tree(context: &mut RuleContext, tree: &syn::UseTree) {
    match tree {
        syn::UseTree::Path(path) => check_tree(context, &path.tree),
        syn::UseTree::Rename(rename) => {
            context.emit(
                "rust-use-alias-forbidden",
                rename.rename.span().start(),
                format!(
                    "use alias `{}` hides path ownership; keep the module prefix at the call site instead",
                    rename.rename,
                ),
            );
        }
        syn::UseTree::Group(group) => {
            for tree in &group.items {
                check_tree(context, tree);
            }
        }
        syn::UseTree::Name(_) | syn::UseTree::Glob(_) => {}
    }
}
