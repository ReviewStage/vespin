// ShareDependencyProvider.m -- React Native's dependencies for the share extension: the app's generated ones, but the Fabric components only of the libraries the extension links.
//
// The provider codegen writes for the app (`RCTAppDependencyProvider`) names
// every component library the app links, each as `NSClassFromString` in one
// dictionary literal, which throws where a class is missing, and the
// extension links only the few its page draws with. So the extension builds
// that dictionary itself, from the components its Info.plist names
// (`VespinFabricComponents`, written by `app.config.ts` from each linked
// library's own codegen config), keeping each class the extension holds.
// The rest, its modules and image loaders among them, are the generated
// provider's, whose module lookups already pass over a missing class.

#import <Foundation/Foundation.h>
#import <ReactAppDependencyProvider/RCTAppDependencyProvider.h>

/// The Info.plist key naming each component the extension links, by component name, with its view's class.
static NSString *const FabricComponentsKey = @"VespinFabricComponents";

@interface ShareDependencyProvider : RCTAppDependencyProvider
@end

@implementation ShareDependencyProvider

- (NSDictionary<NSString *, Class<RCTComponentViewProtocol>> *)thirdPartyFabricComponents
{
  static NSDictionary<NSString *, Class<RCTComponentViewProtocol>> *components = nil;
  static dispatch_once_t once;

  dispatch_once(&once, ^{
    NSDictionary *named = [NSBundle.mainBundle objectForInfoDictionaryKey:FabricComponentsKey];
    NSMutableDictionary<NSString *, Class<RCTComponentViewProtocol>> *found = [NSMutableDictionary new];

    if ([named isKindOfClass:NSDictionary.class]) {
      for (NSString *component in named) {
        id className = named[component];
        Class view = [className isKindOfClass:NSString.class] ? NSClassFromString(className) : nil;

        if (view != nil) found[component] = view;
      }
    }

    components = found;
  });

  return components;
}

@end
