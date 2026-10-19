adamsilver.io

# Does the accept attribute on file inputs work better on Windows and Android?

![Me with tree in the background](https://adamsilver.io/blog/does-the-accept-attribute-on-file-inputs-work-better-on-windows-and-android/)

Adam Silver

[Adam Silver](https://adamsilver.io/)

- [Home](https://adamsilver.io/)
- [Bio](https://adamsilver.io/bio/)
- [Blog](https://adamsilver.io/blog/)
- [Newsletter](https://adamsilver.io/newsletter/)

7 June 2026


# Does the accept attribute on file inputs work better on Windows and Android?

Last week I wrote about the problem with using the `accept` attribute for uploading files.

As a quick reminder:

When you use the `accept` to specify which file types will be allowed like this:

`<input type="file" accept="image/jpeg,image/png">`

…the dialog will disable invalid types like this:

![Opening a file dialog with some files disabled and the user trying to click on them](https://adamsilver.io/assets/images/does-the-accept-attribute-on-file-inputs-work-better-on-windows-and-android/macos.gif)

This is bad because:

- The disabled files are greyed out making them hard to read
- Some users won’t notice the subtle greyed out styling - so will try clicking the invalid files anyway
- And this will make the interface feel unresponsive and broken

But a developer called Jaroslaw responded to me on X to say:

> This is on Apple, elsewhere you get a proper filter that you can disable. I’m against ruining stuff for everyone just because Apple did something stupid.

I appreciated the message because it got me thinking:

“What if the UX on other operating systems like Windows and Android avoid these issues?”

So I decided to take a quick look.

And here’s what I found:

## How Windows implements the accept attribute

Windows hides the invalid files instead of disabling them, like this:

![Windows file dialog hiding invalid files, with a dropdown filter in the bottom right](https://adamsilver.io/assets/images/does-the-accept-attribute-on-file-inputs-work-better-on-windows-and-android/windows-preset-dropdown-custom.png)

This avoids the problem with disabling the files.

So that’s good.

But this leads to another problem:

If the user is looking for a file that they know is inside the folder, and they can’t see it, they’ll be confused.

Most users aren’t going to think:

- “Oh I can’t see the file”
- “That must be because the computer is only showing me valid file types”

It might be even worse if there are no valid files, making the entire folder look empty.

But Jaroslaw’s point was that on Windows, there’s a menu in the bottom-right corner that allows you to remove the filter by switching from “Custom files” to “All files”:

![Windows file dialog with the file type dropdown open, showing 'Custom files' and 'All files' options](https://adamsilver.io/assets/images/does-the-accept-attribute-on-file-inputs-work-better-on-windows-and-android/windows-menu-all.png)

That’s good because it gives users control.

But most users won’t spot the menu. Or think to even look for it.

Think about it. Most people will be thinking:

- “Why can’t I see the file?”
- “Am I in the wrong folder?”
- “I think I’m in the right folder”
- “F\*ck sake”

And maybe they’ll leave the upload flow to check. And when they do, the file will be right there.

This is long-winded and confusing, all because:

The Windows designer assumed that simply adding the drop down menu is enough.

But just a tiny amount of usability testing would prove it’s not.

Funnily enough, I took a closer look at MacOS. And I realised it has the same functionality as Windows.

You have to click “More options” to reveal it:

![macOS file dialog showing the more options menu expanded with a file type filter](https://adamsilver.io/assets/images/does-the-accept-attribute-on-file-inputs-work-better-on-windows-and-android/macos-menu-expanded.png)

That’s worse than just having the menu there, but either way you’ve got confused users.

Confused users = bad UX.

## How Android implements the accept attribute

Android is worse.

Here I’ve set the attribute to only allow PNG, GIF or JPG:

![Android file picker locked to a list of photos with no way to navigate elsewhere](https://adamsilver.io/assets/images/does-the-accept-attribute-on-file-inputs-work-better-on-windows-and-android/android-just-images.png)

All I got were my photos.

There’s no way to browse my files. And there’s no way to use the camera to take another photo, something that’s particularly useful on mobile.

I tested setting the `accept` attribute to allow for DOC, DOCX and PDF - not just images.

This changed the UI completely and gave me the option to use the camera or browse all the files.

![Android file picker showing options for camera and files when multiple types are set](https://adamsilver.io/assets/images/does-the-accept-attribute-on-file-inputs-work-better-on-windows-and-android/android-not-just-images.png)

That’s good.

But then if you browse to any invalid files you get this:

![Android file picker showing files with most of them disabled and hard to distinguish from enabled ones](https://adamsilver.io/assets/images/does-the-accept-attribute-on-file-inputs-work-better-on-windows-and-android/android-disabled.png)

Only one of these files can be selected.

If you’re finding that difficult to see which one that is, that’s the point.

The Android designers completely screwed up every moment of the journey.

But luckily, all you need to is not use the `accept` attribute.

And instead spend your time solving much bigger problems, not just in general, but with file uploading specifically.

Many designers don’t realise that:

Uploading a file is one of the most labour-intensive interactions there is. It involves multiple steps, all that can cause varying degrees of pain.

It’s 100x more complicated than typing words into a box.

So I’m running a live training on Thursday 11 June at 5pm (UK time) where I’ll cover:

1. Uploading a single file — including journeys that move between desktop and mobile
2. Uploading multiple files – two different patterns depending on your use case
3. Async virus checks — something I’ve never seen a design system handle

It’s a 60 minute session with plenty of time for your questions.

Access is included with Form Design Mastery. If you’ve already purchased it, you’ll get an invite shortly. I’ll share a recording after if you can’t attend.

If you haven’t, and would like to, you need to sign up before Thursday. I won’t be promoting this again.

[https://formdesignmastery.com](https://formdesignmastery.com/)

Cheers,

Adam

↓

## Design tips to help you create products that are ridiculously simple and accessible to use

Join 10,000+ designers, content designers and engineers who get my free weekly newsletter with evidence-based design tips (in 3 minutes or less). Mostly forms UX.

First name

Email address

[Adam Silver](https://adamsilver.io/)

- [Links](https://adamsilver.io/links)
- [Tools](https://adamsilver.io/tools)
- [Reading](https://adamsilver.io/reading)

- [Twitter](https://www.twitter.com/adamsilverhq/)
- [Youtube](https://www.youtube.com/@adamsilverhq)
- [LinkedIn](https://uk.linkedin.com/in/adamsilverhq/)