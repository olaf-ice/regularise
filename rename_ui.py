import os
import re

directories = ['public', 'public/js', 'server']

replacements = [
    (r'>Rider<', '>User<'),
    (r'>Riders<', '>Users<'),
    (r' Rider ', ' User '),
    (r' Riders ', ' Users '),
    (r'Rider ID', 'User ID'),
    (r'Rider Login', 'User Login'),
    (r'Rider Registration', 'User Registration'),
    (r'Rider Portal', 'User Portal'),
    (r'Rider Profile', 'User Profile'),
    (r'Rider Not Found', 'User Not Found'),
    (r'rider not found', 'user not found'),
    (r'rider found', 'user found'),
    (r'placeholder="Enter Rider', 'placeholder="Enter User'),
    (r'placeholder="Rider', 'placeholder="User'),
    (r'Manage riders', 'Manage users'),
    (r'Total Riders', 'Total Users'),
    (r'Total riders', 'Total users'),
    (r'Active riders', 'Active users'),
    (r'>riders<', '>users<'),
    (r' riders ', ' users '),
    (r'Rider details', 'User details'),
    (r'No rider', 'No user'),
    (r'invalid rider', 'invalid user'),
    (r'Invalid rider', 'Invalid user'),
    (r'new rider', 'new user'),
    (r'New Rider', 'New User'),
    (r'Rider created', 'User created'),
    (r'rider created', 'user created'),
    (r'>RIDER<', '>USER<'),
    (r'Rider<', 'User<'),
    (r'>Rider', '>User'),
    (r'Riders<', 'Users<'),
    (r'>Riders', '>Users'),
]

for root, dirs, files in os.walk('.'):
    if 'node_modules' in root or '.git' in root or '.gemini' in root:
        continue
    for file in files:
        if file.endswith('.html') or file.endswith('.js'):
            path = os.path.join(root, file)
            with open(path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            new_content = content
            for old, new in replacements:
                new_content = re.sub(old, new, new_content)
            
            if new_content != content:
                with open(path, 'w', encoding='utf-8') as f:
                    f.write(new_content)
                print(f"Updated {path}")
