// VespinRigHermesProfile.mm -- the rig's Hermes sampling profile of a launch: started as the app loads where the launch names `-hermesProfileSeconds <n>`, and after n seconds written, in Chrome's trace format, beside the busy account's answers under Documents/host/busy-account/hermes-profile.json, for the rig to read (`scripts/busy-account.sh --hermes-profile`). A probe of the rig alone: a launch that names no seconds starts nothing.

#import <Foundation/Foundation.h>

#include <hermes/hermes.h>
#include <string>

/** How often the profiler samples the JS thread: a thousand times a second, fine enough to tell apart the holds the rig counts over 50 ms. */
static const double kSamplesPerSecond = 1000;

@interface VespinRigHermesProfile : NSObject
@end

@implementation VespinRigHermesProfile

+ (void)load
{
  NSInteger seconds = [[NSUserDefaults standardUserDefaults] integerForKey:@"hermesProfileSeconds"];

  if (seconds <= 0) {
    return;
  }

  // Note that the profiler is the process's, so it samples the runtime React Native registers for profiling on its JS thread (`HermesInstance`'s `registerForProfiling`), whenever that comes.
  auto *hermesAPI = facebook::jsi::castInterface<facebook::hermes::IHermesRootAPI>(facebook::hermes::makeHermesRootAPI());
  hermesAPI->enableSamplingProfiler(kSamplesPerSecond);

  NSString *documents = NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES).firstObject;
  std::string path = std::string([[documents stringByAppendingPathComponent:@"host/busy-account/hermes-profile.json"] UTF8String]);

  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)seconds * (int64_t)NSEC_PER_SEC), dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
    auto *api = facebook::jsi::castInterface<facebook::hermes::IHermesRootAPI>(facebook::hermes::makeHermesRootAPI());
    api->dumpSampledTraceToFile(path);
    api->disableSamplingProfiler();
  });
}

@end
