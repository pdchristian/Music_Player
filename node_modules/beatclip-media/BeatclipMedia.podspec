Pod::Spec.new do |s|
  s.name             = 'BeatclipMedia'
  s.version          = '1.0.0'
  s.summary          = 'BeatClip native iOS bridge (Now Playing, background audio, open-in inbox)'
  s.homepage         = 'https://localhost/beatclip'
  s.license          = { :type => 'MIT' }
  s.author           = { 'BeatClip' => 'beatclip@localhost' }
  s.source           = { :git => 'https://localhost/beatclip.git', :tag => s.version.to_s }
  s.ios.deployment_target = '15.0'
  s.swift_version    = '5.1'
  s.source_files     = 'ios/Sources/**/*.{swift,h,m,c,cc,cpp}'
  s.dependency 'Capacitor'
  s.frameworks       = 'MediaPlayer', 'AVFoundation', 'UIKit'
end
