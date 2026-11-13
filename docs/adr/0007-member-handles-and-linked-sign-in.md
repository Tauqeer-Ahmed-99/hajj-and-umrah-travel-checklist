# Use unique member handles and one account across sign-in methods

Member usernames are globally unique without regard to case, first and last names are used for display, and email addresses remain private to their account owner. Google sign-in and email-code sign-in for the same verified email must resolve to one account with the same trip memberships. The user chose this over an explicit account-linking step, so authentication setup must preserve the existing member identity rather than create a second profile for the same verified email.
